import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type ValidationArtifactOptions = {
  outputPath?: string | null;
  prefix: string;
};

export type ValidationCliOptions = {
  json: boolean;
  outputPath: string | null;
};

export const VALIDATION_REPORTS_DIR = path.join(process.cwd(), "reports", "validation");

export const parseValidationCliOptions = (argv: string[]): ValidationCliOptions => {
  let json = false;
  let outputPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--output") {
      outputPath = argv[index + 1] ?? null;
      if (outputPath) {
        index += 1;
      }
    }
  }

  return {
    json,
    outputPath,
  };
};

export const saveValidationArtifact = async (
  payload: unknown,
  options: ValidationArtifactOptions
): Promise<string> => {
  const resolvedPath =
    options.outputPath ?? path.join(VALIDATION_REPORTS_DIR, `${options.prefix}-${Date.now()}.json`);

  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return resolvedPath;
};
