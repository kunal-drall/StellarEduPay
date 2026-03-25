/**
 * Retry Service — Stellar Network Outage Recovery
 *
 * When a Stellar network call fails with a transient error (STELLAR_NETWORK_ERROR),
 * the transaction hash is cached in MongoDB as a PendingVerification document.
 * This service runs on a configurable interval, checks network reachability,
 * and re-attempts verification for all queued items using exponential backoff.
 *
 * Guarantees:
 *  - No transaction is lost during a Stellar outage
 *  - Retries stop after MAX_ATTEMPTS (dead-lettered for manual review)
 *  - Only one retry worker runs at a time (re-entrancy guard)
 */

const PendingVerification = require('../models/pendingVerificationModel');
const { verifyTransaction, recordPayment } = require('./stellarService');
const { server } = require('../config/stellarConfig');
const config = require('../config/index');

const RETRY_INTERVAL_MS = config.RETRY_INTERVAL_MS;
const MAX_ATTEMPTS = config.RETRY_MAX_ATTEMPTS;

// Exponential backoff: 1m, 2m, 4m, 8m … capped at 60 minutes
function nextRetryDelay(attempts) {
  const delayMs = Math.min(Math.pow(2, attempts) * 60_000, 60 * 60_000);
  return new Date(Date.now() + delayMs);
}

/**
 * Probe the Stellar Horizon server with a lightweight call.
 * Returns true if the network is reachable, false otherwise.
 */
async function isStellarReachable() {
  try {
    await server.ledgers().order('desc').limit(1).call();
    return true;
  } catch {
    return false;
  }
}

/**
 * Queue a transaction hash for later retry.
 * Safe to call multiple times — upserts on txHash.
 *
 * @param {string} txHash
 * @param {string|null} studentId
 * @param {string} errorMessage
 */
async function queueForRetry(txHash, studentId = null, errorMessage = '') {
  await PendingVerification.findOneAndUpdate(
    { txHash },
    {
      $setOnInsert: { txHash, studentId },
      $set: {
        status: 'pending',
        lastError: errorMessage,
        nextRetryAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
  console.log(`[RetryService] Queued ${txHash} for retry — reason: ${errorMessage}`);
}

let _running = false;
let _timer = null;

/**
 * Process all pending verifications that are due for retry.
 * Re-entrancy guard prevents overlapping runs.
 */
async function processPendingVerifications() {
  if (_running) return;
  _running = true;

  try {
    const due = await PendingVerification.find({
      status: 'pending',
      nextRetryAt: { $lte: new Date() },
    }).limit(50);

    if (due.length === 0) {
      _running = false;
      return;
    }

    // Check network once before processing the batch
    const reachable = await isStellarReachable();
    if (!reachable) {
      console.warn('[RetryService] Stellar network still unreachable — skipping batch');
      _running = false;
      return;
    }

    console.log(`[RetryService] Processing ${due.length} pending verification(s)`);

    for (const item of due) {
      // Mark as processing to prevent concurrent workers picking it up
      await PendingVerification.findByIdAndUpdate(item._id, {
        status: 'processing',
        lastAttemptAt: new Date(),
        $inc: { attempts: 1 },
      });

      try {
        const result = await verifyTransaction(item.txHash);

        if (!result) {
          // Transaction is permanently invalid (bad memo, wrong destination, etc.)
          // Dead-letter it so it doesn't retry forever
          await PendingVerification.findByIdAndUpdate(item._id, {
            status: 'dead_letter',
            lastError: 'verifyTransaction returned null — transaction is permanently invalid',
          });
          console.warn(`[RetryService] Dead-lettered ${item.txHash} — permanently invalid`);
          continue;
        }

        // Record the payment now that verification succeeded
        await recordPayment({
          studentId: result.studentId || result.memo,
          txHash: result.hash,
          amount: result.amount,
          feeAmount: result.expectedAmount || result.feeAmount,
          feeValidationStatus: result.feeValidation.status,
          status: 'confirmed',
          memo: result.memo,
          confirmedAt: result.date ? new Date(result.date) : new Date(),
        });

        await PendingVerification.findByIdAndUpdate(item._id, {
          status: 'resolved',
          resolvedAt: new Date(),
          lastError: null,
        });

        console.log(`[RetryService] Resolved ${item.txHash} after ${item.attempts + 1} attempt(s)`);
      } catch (err) {
        const attempts = item.attempts + 1;
        const isStellarError = !err.code || err.code === 'STELLAR_NETWORK_ERROR';
        const isPermanentError = ['TX_FAILED', 'MISSING_MEMO', 'INVALID_DESTINATION', 'UNSUPPORTED_ASSET', 'DUPLICATE_TX'].includes(err.code);

        if (isPermanentError || attempts >= MAX_ATTEMPTS) {
          await PendingVerification.findByIdAndUpdate(item._id, {
            status: 'dead_letter',
            lastError: err.message,
          });
          console.error(`[RetryService] Dead-lettered ${item.txHash} — ${isPermanentError ? 'permanent error' : 'max attempts reached'}: ${err.message}`);
        } else if (isStellarError) {
          // Transient network error — schedule next retry with backoff
          await PendingVerification.findByIdAndUpdate(item._id, {
            status: 'pending',
            lastError: err.message,
            nextRetryAt: nextRetryDelay(attempts),
          });
          console.warn(`[RetryService] Rescheduled ${item.txHash} (attempt ${attempts}) — next retry at ${nextRetryDelay(attempts).toISOString()}`);
        } else {
          // Unknown error — reschedule conservatively
          await PendingVerification.findByIdAndUpdate(item._id, {
            status: 'pending',
            lastError: err.message,
            nextRetryAt: nextRetryDelay(attempts),
          });
          console.error(`[RetryService] Unknown error for ${item.txHash}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.error('[RetryService] Unexpected error in processPendingVerifications:', err.message);
  } finally {
    _running = false;
  }
}

function startRetryWorker() {
  if (_timer) return;
  console.log(`[RetryService] Starting — interval: ${RETRY_INTERVAL_MS}ms, max attempts: ${MAX_ATTEMPTS}`);
  processPendingVerifications(); // immediate first run
  _timer = setInterval(processPendingVerifications, RETRY_INTERVAL_MS);
}

function stopRetryWorker() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log('[RetryService] Stopped');
  }
}

module.exports = {
  queueForRetry,
  processPendingVerifications,
  isStellarReachable,
  startRetryWorker,
  stopRetryWorker,
};
