# Project Implementation Plan Template

Read `.ai/rules.md` first before starting implementation.

## 1. Project Overview

[Provide a brief overview of the project and its purpose]

This project focuses on [core functionality]. Future versions may include [potential future features].

## 2. Core User Flow

1. [First step in user flow]
2. [Second step in user flow]
3. [Third step in user flow]
4. [Fourth step in user flow]
5. [Fifth step in user flow]

## 3. Important Terminology

- **[Key Term 1]**: [Definition of the term and its significance in the project]
- **[Key Term 2]**: [Definition of the term and its significance in the project]

## 4. Technical Requirements

### Styling Guidelines

All client-side components MUST follow the comprehensive styling guide in `.ai/style-guide.md`.

Key requirements:

- Use SDK CSS classes for all UI elements, avoid inline styles wherever possible
- Follow the component structure pattern in examples
- Use aliased imports and proper error handling
- Validate styling before submitting implementation

### Data Models

#### [Model Name 1]

```typescript
interface ExampleType {
  property1: string;
  property2: number;
  property3: {
    nestedProperty1: boolean;
    nestedProperty2: string;
  };
}
```

Example output:

```ts
{
  "property1": "example value",
  "property2": 123,
  "property3": {
    "nestedProperty1": true,
    "nestedProperty2": "example nested value"
  }
}
```

#### [Model Name 2]

```typescript
interface ExampleType2 {
  // Define another data model
}
```

## 5. User Stories & Acceptance Criteria

### Epic 1: [Epic Name]

#### User Story 1.1 - [User Story Title]

As a [user type], I want to [action] so that [benefit/value]

✅ Acceptance Criteria:

- [Criterion 1]
- [Criterion 2]
- [Criterion 3]

#### User Story 1.2 - [User Story Title]

As a [user type], I want to [action] so that [benefit/value]

✅ Acceptance Criteria:

- [Criterion 1]
- [Criterion 2]
- [Criterion 3]

### Epic 2: [Epic Name]

#### User Story 2.1 - [User Story Title]

As a [user type], I want to [action] so that [benefit/value]

✅ Acceptance Criteria:

- [Criterion 1]
- [Criterion 2]
- [Criterion 3]

## 6. Implementation Plan

### Server-side Components

- [List server-side files to be created/modified]
- [Controller for User Story 1.1]
- [Controller for User Story 1.2]

### Client-side Components

- [List client-side files to be created/modified]
- [Component for User Story 1.1]
- [Component for User Story 2.1]

### API Endpoints

```typescript
// POST /api/endpoint1
// Request: { param1: string, param2: number }
// Response: { success: true, data: ResponseType }

// GET /api/endpoint2
// Response: { success: true, data: ResponseType2[] }
```

### State Management

- [Describe how state will be managed, emphasizing use of GlobalContext]
- [Specify any state needed for User Story 1.1]
- [Specify any state needed for User Story 2.1]

## 7. Testing Approach

- [Describe how each user story will be tested]
- [Specify any mock data needed]

## 8. Validation Checklist

Before submitting the implementation, verify:

- [ ] All user stories are implemented according to acceptance criteria
- [ ] All UI elements use SDK classes, not Tailwind utilities
- [ ] All buttons use `.btn` classes, not custom styling
- [ ] All typography uses SDK classes (`.h1-h4`, `.p1-p4`)
- [ ] All imports use aliased paths, not relative paths
- [ ] Error handling uses GlobalContext
- [ ] Component structure follows the pattern in `.ai/examples/page.md`
- [ ] All API endpoints follow the established pattern and error handling
- [ ] Tests are included for all new functionality

## 9. Post-Implementation Finalization

After the app is implemented, these steps MUST be completed before the app is considered done:

### 9a. Remove Unused Boilerplate Code

The boilerplate ships with example utilities, components, and types that may not be used by the new app. Scan for and remove:

- **Server utils**: Check `server/utils/` for unused files (e.g., `droppedAssets/`, `getBaseUrl.ts`). Trace imports from controllers — if a util is not imported anywhere, remove it.
- **Server types**: Check `server/types/` for unused type files (e.g., `DroppedAssetTypes.ts`). Remove types that are no longer referenced.
- **Client components**: Check `client/src/components/` for unused boilerplate components (e.g., `Accordion.tsx`, `AdminView.tsx`, `AdminIconButton.tsx`, `ConfirmationModal.tsx`, `PageFooter.tsx`). Trace imports from pages — if a component is not imported anywhere, remove it.
- **Barrel exports**: Update `server/utils/index.ts`, `server/types/index.ts`, and `client/src/components/index.ts` to remove exports of deleted files.

**Protected files** (`PageContainer.tsx`, `backendAPI.ts`, etc.) must NOT be removed even if they appear unused — they are part of the framework.

### 9b. Update README

Rewrite `README.md` to describe the new app instead of the boilerplate. Include:

- App name and description
- What visitors see vs. what admins see
- Key features
- API endpoints with request/response shapes
- Data object schemas
- Setup and development instructions

### 9c. Update Server Tests

Rewrite `server/tests/routes.test.ts` to test the new app's actual routes:

- Update the `jest.mock("../utils/index.js")` block to mock the new app's utils (not boilerplate ones like `getDroppedAsset`)
- Update `server/mocks/@rtsdk/topia.ts` to include any new SDK factories/methods used (e.g., `EcosystemFactory`, `WorldActivityFactory`)
- Add test cases for each route covering: success paths, error handling, authorization checks, input validation
- Remove any tests for removed boilerplate routes

### 9d. Commit, Push, and Open PR

- Commit all changes to the `dev` branch
- Push to remote
- Open a PR from `dev` into `main` with appropriate labels
