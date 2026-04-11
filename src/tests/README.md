# Testing Infrastructure

## Overview
This directory contains the testing infrastructure for the Redline PDF editor. Tests are written using Vitest with jsdom environment for DOM APIs.

## Test Organization
```
src/
├── tests/
│   ├── setup.ts                 # Global test setup and mocks
│   └── README.md               # This file
├── services/
│   └── __tests__/
│       ├── storageService.test.ts  # Storage validation tests
│       └── pdfService.test.ts      # PDF validation tests
└── adapters/
    ├── pdfAdapter.ts           # PDF.js mocking boundary
    └── canvasAdapter.ts        # Canvas API mocking boundary
```

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Configuration

### vitest.config.ts
- **Environment**: jsdom (for DOM APIs)
- **Globals**: true (no need to import describe/it/expect)
- **Setup**: ./src/tests/setup.ts runs before tests
- **Coverage**: v8 provider, includes services and hooks

### src/tests/setup.ts
- Imports @testing-library/jest-dom for matchers
- Mocks IndexedDB for storage tests
- Sets up global test environment

## Current Test Coverage

### storageService.test.ts
Tests for validation functions:
- ✅ `validateAnnotationJson()` - Fabric.js JSON validation
  - Empty string handling
  - Empty objects array
  - Invalid JSON detection
  - Missing objects array
  - Type validation
  - XSS vector detection (javascript: protocol)
  - Prototype pollution detection (__proto__, constructor, prototype)

⚠️ **Known Bug**: See `/docs/SECURITY-BUG-VALIDATION.md` for critical prototype chain validation issue

### pdfService.test.ts
Tests for PDF validation:
- ✅ `validatePdfBytes()` behavior (tested indirectly)
  - Minimum size check (100 bytes)
  - PDF magic number (%PDF-)
  - EOF marker (%%EOF)
  - Cross-reference table (xref/startxref)
- ✅ `MAX_PDF_SIZE_BYTES` constant (50MB limit)
- ✅ Edge cases:
  - Minimum valid PDF structure
  - Linearized PDFs
  - EOF marker positions
  - Trailing whitespace

## Mocking Boundaries

### Adapters Pattern
To enable testing without full PDF.js/Canvas setup, we use adapter patterns:

**pdfAdapter.ts**: Wraps pdfjs-dist operations
- `loadDocument()` - Load PDF from ArrayBuffer
- `getPage()` - Get specific page
- `renderPage()` - Render page to canvas

**canvasAdapter.ts**: Wraps Canvas API operations
- `createCanvas()` - Create canvas element
- `getContext()` - Get 2D context
- `toDataURL()` - Export to data URL

These adapters allow tests to mock PDF and canvas operations without requiring workers or actual rendering.

## Testing Philosophy

### What We Test
1. **Pure functions** - Validation logic, data transformations
2. **Business logic** - Rules, constraints, error cases
3. **Edge cases** - Boundary values, error conditions
4. **Security** - XSS vectors, prototype pollution, injection attacks

### What We Don't Test (Yet)
1. **Async PDF loading** - Requires worker setup
2. **Canvas rendering** - Requires DOM rendering
3. **IndexedDB operations** - Mocked for now
4. **React components** - Needs component testing setup
5. **Integration workflows** - Needs E2E test setup

## Future Improvements

### Short Term
1. Fix prototype chain validation bug (see SECURITY-BUG-VALIDATION.md)
2. Export validation functions for easier testing
3. Add tests for other pure functions in services
4. Increase coverage of edge cases

### Medium Term
1. Set up React component testing with @testing-library/react
2. Add integration tests for storage workflows
3. Mock PDF.js worker for async operation tests
4. Add canvas operation tests with mock 2D context

### Long Term
1. E2E tests with Playwright (already installed)
2. Visual regression tests for PDF rendering
3. Performance benchmarks for large PDFs
4. Memory leak detection tests
5. Accessibility testing

## Contributing

When adding new tests:
1. Place tests in `__tests__` folder next to source files
2. Use descriptive test names that explain what and why
3. Follow Arrange-Act-Assert pattern
4. Mock external dependencies at adapter boundaries
5. Document known issues and edge cases
6. Keep tests focused and independent

## Known Issues

1. **Prototype Chain Bug** (HIGH severity)
   - Location: `storageService.ts` line 71
   - Impact: Validation rejects all valid annotations
   - See: `/docs/SECURITY-BUG-VALIDATION.md`

2. **Low Coverage** (Expected)
   - Current: ~5% overall, 12.5% in storageService
   - Reason: Only testing pure validation functions
   - Next: Add component and integration tests

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Jest DOM Matchers](https://github.com/testing-library/jest-dom)
