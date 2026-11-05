import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "sms-panel-package-"));

try {
  const packOutput = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", temporaryDirectory],
    { cwd: projectRoot, encoding: "utf8" },
  );
  const [{ filename }] = JSON.parse(packOutput);
  const tarball = join(temporaryDirectory, filename);
  execFileSync("npm", ["init", "-y"], {
    cwd: temporaryDirectory,
    stdio: "ignore",
  });
  execFileSync("npm", ["install", "--ignore-scripts", tarball], {
    cwd: temporaryDirectory,
    stdio: "ignore",
  });

  writeFileSync(
    join(temporaryDirectory, "esm.mjs"),
    'import { defineSmsActions, sms } from "sms-panel-manager";\n' +
      'import { GhasedakAdapter } from "sms-panel-manager/providers";\n' +
      'import { createSmsMongooseModels } from "sms-panel-manager/mongoose";\n' +
      "if (!defineSmsActions || !sms || !GhasedakAdapter || !createSmsMongooseModels) process.exit(1);\n",
  );
  writeFileSync(
    join(temporaryDirectory, "commonjs.cjs"),
    'const core = require("sms-panel-manager");\n' +
      'const providers = require("sms-panel-manager/providers");\n' +
      'const persistence = require("sms-panel-manager/mongoose");\n' +
      "if (!core.sms || !providers.KavenegarAdapter || !persistence.createSmsMongooseModels) process.exit(1);\n",
  );
  execFileSync(process.execPath, ["esm.mjs"], { cwd: temporaryDirectory });
  execFileSync(process.execPath, ["commonjs.cjs"], { cwd: temporaryDirectory });

  const installed = JSON.parse(
    readFileSync(
      join(
        temporaryDirectory,
        "node_modules",
        "sms-panel-manager",
        "package.json",
      ),
      "utf8",
    ),
  );
  for (const subpath of [".", "./mongoose", "./providers", "./nestjs"]) {
    if (installed.exports[subpath] === undefined) {
      throw new Error(`Missing package export: ${subpath}`);
    }
  }
  process.stdout.write(
    "Installed-package ESM/CJS and subpath checks passed.\n",
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
