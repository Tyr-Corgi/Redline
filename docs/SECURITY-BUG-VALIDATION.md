# Security Bug: Prototype Chain Validation Issue

## Location
`src/services/storageService.ts` - `validateAnnotationJson()` function (lines 65-79)

## Severity
**HIGH** - The validation function is currently broken and rejects ALL valid annotations.

## Issue
The validation function uses the `in` operator to check for dangerous keys (`__proto__`, `constructor`, `prototype`):

```typescript
if (DANGEROUS_KEYS.some(key => key in obj)) return false;
```

The `in` operator checks the **entire prototype chain**, not just own properties. Since all JavaScript objects inherit from `Object.prototype`, they all have these properties in their prototype chain. This causes the function to reject **all objects with any properties**.

## Current Impact
- The validation function currently rejects ALL valid Fabric.js annotations
- Empty annotation sets (empty string or empty objects array) are the only accepted inputs
- This effectively breaks the annotation storage feature

## Evidence
Test file: `src/services/__tests__/storageService.test.ts`

```javascript
const obj = { type: 'rect', left: 10 };
'__proto__' in obj; // true (inherited from Object.prototype)
obj.hasOwnProperty('__proto__'); // false (not an own property)
```

## Recommended Fix
Replace the `in` operator with `Object.prototype.hasOwnProperty.call()`:

```typescript
// BEFORE (buggy):
if (DANGEROUS_KEYS.some(key => key in obj)) return false;

// AFTER (correct):
if (DANGEROUS_KEYS.some(key => Object.prototype.hasOwnProperty.call(obj, key))) return false;
```

Apply the same fix to the nested check on line 76.

## Test Coverage
Tests have been written to document the current (buggy) behavior:
- `src/services/__tests__/storageService.test.ts`
- Tests will need to be updated after the fix is applied
- See test comments for detailed documentation of the issue

## Next Steps
1. Apply the recommended fix to `validateAnnotationJson()`
2. Apply the same fix to the nested `checkNested()` function
3. Update tests to verify correct behavior after fix
4. Test with actual Fabric.js annotation data
5. Consider adding integration tests with real annotation workflows
