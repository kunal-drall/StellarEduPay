const { verifyTransaction, syncPayments, validatePaymentAgainstFee, recordPayment } = require('../backend/src/services/stellarService');

// Base mock transaction factory
function makeTx(overrides = {}) {
  return {
    hash: 'abc123',
    memo: 'STU001',
    successful: true,
    created_at: new Date().toISOString(),
    operations: async () => ({
      records: [{ type: 'payment', to: 'GTEST123', amount: '200.0000000', asset_type: 'native' }],
    }),
    ...overrides,
  };
}

jest.mock('../backend/src/config/stellarConfig', () => ({
  SCHOOL_WALLET: 'GTEST123',
  ACCEPTED_ASSETS: {
    XLM: { code: 'XLM', type: 'native', issuer: null, displayName: 'Stellar Lumens', decimals: 7 },
    USDC: { code: 'USDC', type: 'credit_alphanum4', issuer: 'GISSUER', displayName: 'USD Coin', decimals: 7 },
  },
  isAcceptedAsset: (code, type) => {
    const assets = {
      XLM: { code: 'XLM', type: 'native' },
      USDC: { code: 'USDC', type: 'credit_alphanum4' },
    };
    const asset = assets[code];
    if (!asset || asset.type !== type) return { accepted: false, asset: null };
    return { accepted: true, asset };
  },
  server: {
    transactions: () => ({
      forAccount: () => ({
        order: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }),
      }),
      transaction: (hash) => ({
        call: async () => ({
          hash,
          memo: 'STU001',
          successful: true,
          created_at: new Date().toISOString(),
          operations: async () => ({
            records: [{ type: 'payment', to: 'GTEST123', amount: '200.0000000', asset_type: 'native' }],
          }),
        }),
      }),
    }),
  },
}));

jest.mock('../backend/src/models/paymentModel', () => ({
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue({}),
  find: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }),
}));
jest.mock('../backend/src/models/studentModel', () => ({
  findOne: jest.fn().mockResolvedValue({ studentId: 'STU001', feeAmount: 200 }),
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
}));

describe('stellarService', () => {
  test('syncPayments runs without error', async () => {
    await expect(syncPayments()).resolves.toBeUndefined();
  });

  test('verifyTransaction returns payment details with asset info and fee validation', async () => {
    const result = await verifyTransaction('abc123');
    expect(result).toMatchObject({
      hash: 'abc123',
      memo: 'STU001',
      amount: 200,
      assetCode: 'XLM',
      assetType: 'native',
      feeAmount: 200,
    });
    expect(result.feeValidation).toHaveProperty('status', 'valid');
  });

  test('verifyTransaction throws TX_FAILED for unsuccessful transaction', async () => {
    const { server } = require('../backend/src/config/stellarConfig');
    const original = server.transactions;
    server.transactions = () => ({
      transaction: () => ({ call: async () => makeTx({ successful: false }) }),
    });
    await expect(verifyTransaction('fail123')).rejects.toMatchObject({ code: 'TX_FAILED' });
    server.transactions = original;
  });

  test('verifyTransaction throws MISSING_MEMO when memo is absent', async () => {
    const { server } = require('../backend/src/config/stellarConfig');
    const original = server.transactions;
    server.transactions = () => ({
      transaction: () => ({ call: async () => makeTx({ memo: null }) }),
    });
    await expect(verifyTransaction('nomemo')).rejects.toMatchObject({ code: 'MISSING_MEMO' });
    server.transactions = original;
  });

  test('verifyTransaction throws INVALID_DESTINATION when no matching payment op', async () => {
    const { server } = require('../backend/src/config/stellarConfig');
    const original = server.transactions;
    server.transactions = () => ({
      transaction: () => ({
        call: async () => makeTx({
          operations: async () => ({
            records: [{ type: 'payment', to: 'GWRONGWALLET', amount: '200.0', asset_type: 'native' }],
          }),
        }),
      }),
    });
    await expect(verifyTransaction('wrongdest')).rejects.toMatchObject({ code: 'INVALID_DESTINATION' });
    server.transactions = original;
  });

  test('verifyTransaction throws UNSUPPORTED_ASSET for unknown asset', async () => {
    const { server } = require('../backend/src/config/stellarConfig');
    const original = server.transactions;
    server.transactions = () => ({
      transaction: () => ({
        call: async () => makeTx({
          operations: async () => ({
            records: [{ type: 'payment', to: 'GTEST123', amount: '200.0', asset_type: 'credit_alphanum4', asset_code: 'SHIB', asset_issuer: 'GRANDOM' }],
          }),
        }),
      }),
    });
    await expect(verifyTransaction('badasset')).rejects.toMatchObject({ code: 'UNSUPPORTED_ASSET' });
    server.transactions = original;
  });
});

describe('validatePaymentAgainstFee', () => {
  test('returns valid when payment matches fee', () => {
    expect(validatePaymentAgainstFee(200, 200).status).toBe('valid');
  });

  test('returns underpaid when payment is less than fee', () => {
    expect(validatePaymentAgainstFee(150, 200).status).toBe('underpaid');
  });

  test('returns overpaid when payment exceeds fee', () => {
    expect(validatePaymentAgainstFee(250, 200).status).toBe('overpaid');
  });
});

describe('recordPayment', () => {
  const Payment = require('../backend/src/models/paymentModel');

  const paymentData = { studentId: 'STU001', txHash: 'abc123', amount: 200, feeAmount: 200, feeValidationStatus: 'valid', status: 'confirmed', memo: 'STU001', confirmedAt: new Date() };

  beforeEach(() => jest.clearAllMocks());

  test('saves payment when txHash is new', async () => {
    Payment.findOne.mockResolvedValueOnce(null);
    await expect(recordPayment(paymentData)).resolves.toBeDefined();
    expect(Payment.create).toHaveBeenCalledWith(paymentData);
  });

  test('saves payment with confirmed status', async () => {
    Payment.findOne.mockResolvedValueOnce(null);
    await recordPayment(paymentData);
    expect(Payment.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
  });

  test('throws DUPLICATE_TX when txHash already exists', async () => {
    Payment.findOne.mockResolvedValueOnce({ txHash: 'abc123' });
    await expect(recordPayment(paymentData)).rejects.toMatchObject({ code: 'DUPLICATE_TX' });
    expect(Payment.create).not.toHaveBeenCalled();
  });

  test('throws DUPLICATE_TX on MongoDB duplicate key error (race condition)', async () => {
    Payment.findOne.mockResolvedValueOnce(null);
    const mongoErr = Object.assign(new Error('E11000'), { code: 11000 });
    Payment.create.mockRejectedValueOnce(mongoErr);
    await expect(recordPayment(paymentData)).rejects.toMatchObject({ code: 'DUPLICATE_TX' });
  });
});
