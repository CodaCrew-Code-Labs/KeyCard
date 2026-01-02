# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-02

### Added

- Initial release of KeyCard Subscription Backend
- Core subscription management features
  - Create, read, update, delete subscription plans
  - Subscribe users to plans
  - Upgrade/downgrade subscriptions
  - Cancel subscriptions (immediate or end-of-period)
  - Pause/resume subscriptions
  - Track subscription status
- Plan management with multiple pricing models
  - Flat rate pricing
  - Tiered pricing
  - Per-seat pricing
  - Usage-based (metered) billing
  - Free trial support
  - Setup fees
- Billing and invoicing
  - Auto-generate invoices on billing cycle
  - Invoice history and retrieval
  - Payment status tracking
  - Failed payment retry logic
  - Pro-rated billing calculations
  - Tax calculation support
- Multi-tenancy support
  - Tenant isolation via tenant_id
  - Tenant-specific plan configurations
  - Automatic query filtering
- Webhooks
  - Subscription lifecycle events
  - Payment events
  - Invoice events
  - Webhook signature verification
  - Automatic retry for failed webhooks
- Analytics & Reporting
  - MRR (Monthly Recurring Revenue)
  - Churn rate tracking
  - Revenue breakdown by time period
- Payment integration
  - DoDo Payments adapter included
  - Extensible payment adapter system
  - Support for custom payment processors
- Database
  - PostgreSQL support via Prisma ORM
  - Complete schema with 8 tables
  - Automatic migrations support
- API
  - RESTful endpoints for all operations
  - Programmatic API for direct service access
  - Full TypeScript support
  - Request validation with Zod
- Middleware
  - Authentication (bring-your-own-auth)
  - Tenant context management
  - Rate limiting
  - CORS support
  - Global error handling
- Background jobs
  - Billing cycle processing
  - Failed payment retry (dunning)
  - Webhook delivery and retry
- Lifecycle hooks
  - onSubscriptionCreated
  - onSubscriptionUpdated
  - onSubscriptionCanceled
  - onPaymentSucceeded
  - onPaymentFailed
  - onInvoiceGenerated
- Testing
  - Comprehensive unit tests
  - Jest configuration
  - Mock payment adapter for testing
- Documentation
  - Complete README with examples
  - API documentation
  - Configuration guide
  - Usage examples

### Security

- SQL injection protection via Prisma ORM
- Webhook signature verification
- Encrypted storage for sensitive data
- Rate limiting on all endpoints
- CORS configuration

## [Unreleased]

### Planned Features

- Additional payment providers (Stripe, PayPal, Razorpay)
- Dunning email templates
- Customer portal UI components
- Discount codes and promotions
- Revenue recognition reports
- Subscription analytics dashboard
- GraphQL API support
- Subscription pausing schedules
- Metered billing aggregation
- Tax compliance (EU VAT, US sales tax)
