# Transaction Fee Tracking

## Summary

Track network fees associated with each payment. Extract fees from Stellar transactions, store them in the database, and make them visible in the payment records.

## Tasks

- [x] Extract fee from transaction
- [x] Store in database

## Changes

### Modified Files

| File | Description |
| ---- | ----------- |
| [`backend/src/models/paymentModel.js`](backend/src/models/paymentModel.js) | Added `networkFee` field |
| [`backend/src/services/stellarService.js`](backend/src/services/stellarService.js) | Added fee extraction from Stellar transactions |
| [`backend/src/controllers/paymentController.js`](backend/src/controllers/paymentController.js) | Stores and returns network fees in API |

### New Files

| File | Description |
| ---- | ----------- |
| [`test_fee_tracking.js`](test_fee_tracking.js) | Integration test |
| [`verify_fee_tracking.js`](verify_fee_tracking.js) | Verification script |

## Acceptance Criteria

- [x] Fees are recorded and visible

## Implementation

Network fees are extracted from Stellar transactions using:
```javascript
const networkFee = parseFloat(tx.fee_paid || '0') / 10000000;
```

The fees are stored in the payment record and returned in API responses.
