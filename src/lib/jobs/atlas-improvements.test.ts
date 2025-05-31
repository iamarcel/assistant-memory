/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, expect, it } from "vitest";

describe("Atlas Improvements", () => {
  describe("User Atlas Prompt", () => {
    it("should include instructions for fact vs assumption distinction", () => {
      // Import the module to get the prompt content
      // Note: This is a basic structural test since the actual prompts are built at runtime
      const fs = require("fs");
      const path = require("path");
      const userAtlasContent = fs.readFileSync(
        path.join(__dirname, "atlas-user.ts"),
        "utf8",
      );

      // Check that key improvements are present in the prompt
      expect(userAtlasContent).toContain(
        "Only store information that the user has explicitly stated or confirmed as fact",
      );
      expect(userAtlasContent).toContain(
        "Do not store assistant assumptions, guesses, or interpretations",
      );
      expect(userAtlasContent).toContain(
        "MANDATORY:** Include specific dates (YYYY-MM-DD format)",
      );
      expect(userAtlasContent).toContain(
        "immediately remove or update** the contradicted information",
      );
      expect(userAtlasContent).toContain(
        "Actively remove information that is clearly outdated",
      );
    });
  });

  describe("Assistant Atlas Prompt", () => {
    it("should include instructions for observations vs assumptions", () => {
      const fs = require("fs");
      const path = require("path");
      const assistantAtlasContent = fs.readFileSync(
        path.join(__dirname, "atlas-assistant.ts"),
        "utf8",
      );

      // Check that key improvements are present in the prompt
      expect(assistantAtlasContent).toContain(
        "Record only what can be directly observed from interactions",
      );
      expect(assistantAtlasContent).toContain(
        "Avoid storing assumptions, guesses, or interpretations as established facts",
      );
      expect(assistantAtlasContent).toContain(
        "MANDATORY:** Include the date (YYYY-MM-DD format)",
      );
      expect(assistantAtlasContent).toContain(
        "Actively remove outdated relationship patterns",
      );
      expect(assistantAtlasContent).toContain(
        "Date Tracking:** When adding or updating any entry",
      );
    });
  });

  describe("Date Format Validation", () => {
    it("should specify YYYY-MM-DD format consistently", () => {
      const fs = require("fs");
      const path = require("path");

      const userAtlasContent = fs.readFileSync(
        path.join(__dirname, "atlas-user.ts"),
        "utf8",
      );
      const assistantAtlasContent = fs.readFileSync(
        path.join(__dirname, "atlas-assistant.ts"),
        "utf8",
      );

      // Both files should specify the YYYY-MM-DD format
      expect(userAtlasContent).toContain("YYYY-MM-DD format");
      expect(assistantAtlasContent).toContain("YYYY-MM-DD format");

      // Should have specific examples
      expect(userAtlasContent).toContain("2024-01-15");
      expect(userAtlasContent).toContain("2024-02-01");
    });
  });

  describe("Removal Guidance", () => {
    it("should provide specific timeframes for removal", () => {
      const fs = require("fs");
      const path = require("path");

      const userAtlasContent = fs.readFileSync(
        path.join(__dirname, "atlas-user.ts"),
        "utf8",
      );
      const assistantAtlasContent = fs.readFileSync(
        path.join(__dirname, "atlas-assistant.ts"),
        "utf8",
      );

      // Should specify timeframes for removal
      expect(userAtlasContent).toContain("over 30 days");
      expect(assistantAtlasContent).toContain("14+ days");
      expect(assistantAtlasContent).toContain("30+ days");

      // Should favor removal when in doubt
      expect(userAtlasContent).toContain("favor removal over retention");
    });
  });
});
