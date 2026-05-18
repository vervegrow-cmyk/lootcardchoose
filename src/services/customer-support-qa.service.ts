import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  CustomerSupportKnowledgeBundle,
  CustomerSupportQaEntry,
  CustomerSupportTopic,
} from "../agents/customer-support/customer-support.types";
import { logger } from "../utils/logger";

const QA_DIRECTORY = path.resolve(process.cwd(), "data", "customer-support-qa");
const KNOWLEDGE_FILE = "customer-support.md";
const STYLE_RULES_HEADING = "# Customer Support Style Rules";
const QA_KNOWLEDGE_HEADING = "# Customer Support QA Knowledge";
const FALLBACK_RULES_HEADING = "# Fallback Rules";

const normalizePromptSection = (value: string): string =>
  value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

const mapTitleToTopic = (title: string): CustomerSupportTopic => {
  const normalized = title.trim().toLowerCase();
  if (
    normalized.includes("shipping") ||
    normalized.includes("delivery") ||
    normalized.includes("address") ||
    normalized.includes("tracking") ||
    normalized.includes("carrier") ||
    normalized.includes("order")
  ) {
    return "shipping";
  }
  if (normalized.includes("pricing") || normalized.includes("discount") || normalized.includes("free shipping")) {
    return "pricing";
  }
  if (
    normalized.includes("payment") ||
    normalized.includes("checkout") ||
    normalized.includes("refund") ||
    normalized.includes("return")
  ) {
    return "payment";
  }
  if (normalized.includes("product") || normalized.includes("stock") || normalized.includes("custom")) {
    return "product";
  }
  if (normalized.includes("pre-sale") || normalized.includes("buying") || normalized.includes("multiple")) {
    return "pre_sale";
  }
  return "general";
};

const extractSection = (contents: string, heading: string): string => {
  const normalizedContents = contents.replace(/\r\n/g, "\n");
  const startIndex = normalizedContents.indexOf(heading);
  if (startIndex < 0) {
    return "";
  }

  const sectionStart = startIndex + heading.length;
  const remainder = normalizedContents.slice(sectionStart);
  const nextHeadingIndex = remainder.search(/\n#\s+/);
  const sectionBody = nextHeadingIndex >= 0 ? remainder.slice(0, nextHeadingIndex) : remainder;
  return sectionBody.trim();
};

const parseQaBlock = (block: string, fileName: string, inheritedTitle = ""): CustomerSupportQaEntry | null => {
  const trimmed = block.trim();
  if (!trimmed) {
    return null;
  }

  const titleMatch = trimmed.match(/^##\s+(.+)$/m);
  const questionMatch = trimmed.match(/Q:\s*([\s\S]*?)\nA:/i);
  const answerMatch = trimmed.match(/A:\s*([\s\S]*)$/i);
  const question = questionMatch?.[1]?.trim() ?? "";
  const answer = answerMatch?.[1]?.trim() ?? "";
  const resolvedTitle = titleMatch?.[1]?.trim() ?? inheritedTitle;

  if (!question || !answer) {
    logger.warn("[CUSTOMER SUPPORT QA] skipped malformed block", {
      fileName,
      preview: trimmed.slice(0, 120),
    });
    return null;
  }

  return {
    topic: mapTitleToTopic(resolvedTitle),
    title: resolvedTitle,
    question,
    answer,
    sourceFile: fileName,
  };
};

const parseQaMarkdown = (contents: string, fileName: string): CustomerSupportQaEntry[] => {
  const blocks = contents.split(/\r?\n---\r?\n/g);
  const entries: CustomerSupportQaEntry[] = [];
  let currentTitle = "";

  for (const block of blocks) {
    const titleMatch = block.match(/^##\s+(.+)$/m);
    if (titleMatch?.[1]) {
      currentTitle = titleMatch[1].trim();
    }

    const entry = parseQaBlock(block, fileName, currentTitle);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
};

export const customerSupportQaService = {
  loadKnowledgeBundle(): CustomerSupportKnowledgeBundle {
    const filePath = path.resolve(QA_DIRECTORY, KNOWLEDGE_FILE);
    if (!existsSync(filePath)) {
      logger.warn("[CUSTOMER SUPPORT QA] file missing", { fileName: KNOWLEDGE_FILE, filePath });
      return {
        entries: [],
        styleRulesText: "",
        fallbackRulesText: "",
      };
    }

    const contents = readFileSync(filePath, "utf8");
    const qaSection = normalizePromptSection(extractSection(contents, QA_KNOWLEDGE_HEADING));
    const styleRulesText = normalizePromptSection(extractSection(contents, STYLE_RULES_HEADING));
    const fallbackRulesText = normalizePromptSection(extractSection(contents, FALLBACK_RULES_HEADING));

    if (!qaSection) {
      logger.warn("[CUSTOMER SUPPORT QA] QA section missing", {
        fileName: KNOWLEDGE_FILE,
        heading: QA_KNOWLEDGE_HEADING,
      });
    }

    return {
      entries: parseQaMarkdown(qaSection, KNOWLEDGE_FILE),
      styleRulesText,
      fallbackRulesText,
    };
  },
};
