import { z } from "zod";

export const PROJECT_METADATA_FILE_NAME = "author-copilot.json";
export const CURRENT_PROJECT_SCHEMA_VERSION = 1 as const;

export const ProjectTemplateSchema = z.enum(["novel", "screenplay"]);
export type ProjectTemplate = z.infer<typeof ProjectTemplateSchema>;

export const ProjectMetadataV1Schema = z.strictObject({
  schemaVersion: z.literal(CURRENT_PROJECT_SCHEMA_VERSION),
  projectId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  template: ProjectTemplateSchema,
  createdAt: z.iso.datetime(),
});

export type ProjectMetadataV1 = z.infer<typeof ProjectMetadataV1Schema>;
export type ProjectMetadata = ProjectMetadataV1;

const ProjectMetadataVersionEnvelopeSchema = z.object({
  schemaVersion: z.number().int().nonnegative(),
});

export class UnsupportedProjectSchemaVersionError extends Error {
  readonly schemaVersion: number | undefined;

  constructor(schemaVersion: number | undefined) {
    super(
      schemaVersion === undefined
        ? "Project metadata does not declare a schemaVersion."
        : `Project metadata schemaVersion ${schemaVersion} is not supported.`,
    );
    this.name = "UnsupportedProjectSchemaVersionError";
    this.schemaVersion = schemaVersion;
  }
}

export type ProjectMetadataMigration = (input: unknown) => ProjectMetadata;

// Version 1 is the initial format. Add one migration per prior version here.
export const PROJECT_METADATA_MIGRATIONS: Readonly<
  Record<number, ProjectMetadataMigration>
> = Object.freeze({});

export function parseProjectMetadata(input: unknown): ProjectMetadata {
  return ProjectMetadataV1Schema.parse(input);
}

export function migrateProjectMetadata(input: unknown): ProjectMetadata {
  const envelope = ProjectMetadataVersionEnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    throw new UnsupportedProjectSchemaVersionError(undefined);
  }

  if (envelope.data.schemaVersion === CURRENT_PROJECT_SCHEMA_VERSION) {
    return parseProjectMetadata(input);
  }

  const migration = PROJECT_METADATA_MIGRATIONS[envelope.data.schemaVersion];
  if (migration === undefined) {
    throw new UnsupportedProjectSchemaVersionError(envelope.data.schemaVersion);
  }

  return parseProjectMetadata(migration(input));
}
