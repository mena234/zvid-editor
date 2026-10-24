/** Matches the scene ID rules enforced by orch/middleware/validation.js. */
export const MAX_SCENE_ID_LENGTH = 100

export function sceneIdError(id: unknown, otherIds: readonly unknown[] = []): string | null {
  if (typeof id !== 'string') {
    return 'Scene ID must be text. Enter an ID such as "intro-1".'
  }
  if (!id.length) {
    return 'Scene ID cannot be empty. Enter an ID such as "intro-1".'
  }
  if (id.length > MAX_SCENE_ID_LENGTH) {
    return `Scene ID must be ${MAX_SCENE_ID_LENGTH} characters or fewer (currently ${id.length}).`
  }
  if (/[^a-zA-Z0-9_-]/.test(id)) {
    return 'Scene ID can only contain letters (A-Z, a-z), numbers (0-9), hyphens (-), and underscores (_). Spaces and other characters are not allowed. Example: "intro-1".'
  }
  if (otherIds.includes(id)) {
    return `Duplicate scene id "${id}". Choose a unique ID for each scene.`
  }
  return null
}
