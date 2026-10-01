import type {
  CreativeNote,
  CreativeNoteCreateRequest,
  CreativeNoteDeleteRequest,
  CreativeNoteUpdateRequest,
} from "@author-copilot/contracts";

export class CreativeNotesApiError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "CreativeNotesApiError";
  }
}

function unwrap<T extends { ok: true } | { ok: false; error: string }>(
  response: T,
): Extract<T, { ok: true }> {
  if (!response.ok) throw new CreativeNotesApiError(response.error);
  return response as Extract<T, { ok: true }>;
}

export function getCreativeNotesApi(): {
  readonly list: (projectId: string) => Promise<readonly CreativeNote[]>;
  readonly create: (
    request: Omit<CreativeNoteCreateRequest, "projectId"> & {
      projectId: string;
    },
  ) => Promise<CreativeNote>;
  readonly update: (
    request: Omit<CreativeNoteUpdateRequest, "projectId"> & {
      projectId: string;
    },
  ) => Promise<CreativeNote>;
  readonly delete: (request: CreativeNoteDeleteRequest) => Promise<boolean>;
} {
  const raw = window.authorCopilot.creativeNotes;
  return {
    async list(projectId) {
      return unwrap(await raw.list({ projectId })).notes;
    },
    async create(request) {
      return unwrap(await raw.create(request)).note;
    },
    async update(request) {
      return unwrap(await raw.update(request)).note;
    },
    async delete(request) {
      return unwrap(await raw.delete(request)).deleted;
    },
  };
}
