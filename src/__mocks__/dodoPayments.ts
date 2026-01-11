// Mock DodoPayments SDK
export const mockCheckoutSessions = {
  create: jest.fn(),
  retrieve: jest.fn(),
};

export const mockDodoPaymentsClient = {
  checkoutSessions: mockCheckoutSessions,
};

// Reset all mocks
export const resetDodoPaymentsMocks = () => {
  mockCheckoutSessions.create.mockReset();
  mockCheckoutSessions.retrieve.mockReset();
};

// Mock DodoPayments constructor
jest.mock('dodopayments', () => {
  return jest.fn(() => mockDodoPaymentsClient);
});

export default mockDodoPaymentsClient;
