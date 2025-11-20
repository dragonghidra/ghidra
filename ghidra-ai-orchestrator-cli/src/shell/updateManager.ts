import { spawn } from 'node:child_process';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { display } from '../ui/display.js';

const PACKAGE_NAME = 'apt-cli';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const FETCH_TIMEOUT_MS = 4000;

export async function maybeOfferCliUpdate(currentVersion: string): Promise<boolean> {
  try {
    const latestVersion = await fetchLatestVersion();
    if (!latestVersion) {
      return true;
    }

    if (!isNewerVersion(latestVersion, currentVersion)) {
      return true;
    }

    display.showInfo(
      [
        `A new APT CLI release is available.`,
        `Current version: ${currentVersion}`,
        `Latest version: ${latestVersion}`,
      ].join('\n')
    );

    if (!input.isTTY || !output.isTTY) {
      display.showInfo(
        `Run "npm install -g ${PACKAGE_NAME}@latest" when you're ready to upgrade.`
      );
      return true;
    }

    const shouldUpdate = await promptForUpdate();
    if (!shouldUpdate) {
      display.showInfo(
        `Continuing with ${currentVersion}. You can upgrade later via "npm install -g ${PACKAGE_NAME}@latest".`
      );
      return true;
    }

    const success = await installLatestVersion();
    if (success) {
      display.showInfo(
        `Update complete. Relaunch the CLI to start using ${PACKAGE_NAME}@${latestVersion}.`
      );
      return false;
    }

    display.showWarning(
      `Failed to install ${PACKAGE_NAME}@latest. Please run "npm install -g ${PACKAGE_NAME}@latest" manually.`
    );
    return true;
  } catch {
    return true;
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(REGISTRY_URL, {
      headers: { 'user-agent': `${PACKAGE_NAME}/update-check` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { version?: string };
    return typeof payload.version === 'string' ? payload.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = normalizeVersion(latest);
  const currentParts = normalizeVersion(current);
  const length = Math.max(latestParts.length, currentParts.length);
  for (let index = 0; index < length; index += 1) {
    const nextLatest = latestParts[index] ?? 0;
    const nextCurrent = currentParts[index] ?? 0;
    if (nextLatest > nextCurrent) {
      return true;
    }
    if (nextLatest < nextCurrent) {
      return false;
    }
  }
  return false;
}

function normalizeVersion(value: string): number[] {
  const sanitized = value.split('-')[0] ?? '';
  return sanitized
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .filter((segment) => Number.isFinite(segment) && segment >= 0);
}

async function promptForUpdate(): Promise<boolean> {
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question('Update now? (Y/n): ');
    const normalized = answer.trim().toLowerCase();
    return normalized === '' || normalized === 'y' || normalized === 'yes';
  } finally {
    prompt.close();
  }
}

async function installLatestVersion(): Promise<boolean> {
  const binary = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return new Promise((resolve) => {
    const child = spawn(binary, ['install', '-g', `${PACKAGE_NAME}@latest`], {
      stdio: 'inherit',
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
