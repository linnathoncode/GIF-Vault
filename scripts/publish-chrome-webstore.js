#!/usr/bin/env node

/**
 * Publishes the built extension package through Chrome Web Store API V2.
 *
 * This script expects CI-provided OAuth credentials and item identifiers. It
 * uploads a zip package, waits for upload processing to settle, submits the
 * item for review/publishing, and prints the resulting store status.
 */

const fs = require("fs");
const path = require("path");

const API_ROOT = "https://chromewebstore.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const WAIT_MS = 10000;
const MAX_STATUS_ATTEMPTS = 12;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getArgValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function parseBooleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  return ["1", "true", "yes"].includes(value.toLowerCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getUploadState(status) {
  return status.uploadState || status.lastAsyncUploadState || status.itemStatus?.uploadState;
}

function isUploadInProgress(uploadState) {
  return uploadState === "IN_PROGRESS" || uploadState === "UPLOAD_IN_PROGRESS";
}

function isUploadSucceeded(uploadState) {
  return uploadState === "SUCCEEDED" || uploadState === "UPLOAD_PROCESSED";
}

async function readJsonResponse(response, context) {
  const text = await response.text();
  let body = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new Error(`${context} returned non-JSON response: ${text}`);
    }
  }

  if (!response.ok) {
    throw new Error(`${context} failed (${response.status}): ${JSON.stringify(body, null, 2)}`);
  }

  return body;
}

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const body = await readJsonResponse(response, "OAuth token refresh");
  if (!body.access_token) {
    throw new Error("OAuth token refresh did not return an access_token.");
  }
  return body.access_token;
}

async function uploadPackage({ accessToken, publisherId, extensionId, zipPath }) {
  const zip = fs.readFileSync(zipPath);
  const name = `publishers/${publisherId}/items/${extensionId}`;
  const uploadUrl = `${API_ROOT}/upload/v2/${name}:upload`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/zip",
    },
    body: zip,
  });

  return readJsonResponse(response, "Chrome Web Store upload");
}

async function fetchStatus({ accessToken, publisherId, extensionId }) {
  const name = `publishers/${publisherId}/items/${extensionId}`;
  const statusUrl = `${API_ROOT}/v2/${name}:fetchStatus`;
  const response = await fetch(statusUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return readJsonResponse(response, "Chrome Web Store status fetch");
}

async function waitForUpload({ accessToken, publisherId, extensionId }) {
  for (let attempt = 1; attempt <= MAX_STATUS_ATTEMPTS; attempt += 1) {
    const status = await fetchStatus({ accessToken, publisherId, extensionId });
    const uploadState = getUploadState(status);

    console.log(`Upload status check ${attempt}/${MAX_STATUS_ATTEMPTS}: ${uploadState || "unknown"}`);
    if (uploadState && !isUploadInProgress(uploadState)) {
      if (!isUploadSucceeded(uploadState)) {
        throw new Error(`Upload did not process successfully: ${uploadState}`);
      }
      return status;
    }

    await sleep(WAIT_MS);
  }

  throw new Error("Upload did not finish processing before the status timeout.");
}

async function publishItem({ accessToken, publisherId, extensionId }) {
  const name = `publishers/${publisherId}/items/${extensionId}`;
  const publishUrl = `${API_ROOT}/v2/${name}:publish`;
  const deployPercentage = process.env.CWS_DEPLOY_PERCENTAGE
    ? Number.parseInt(process.env.CWS_DEPLOY_PERCENTAGE, 10)
    : undefined;
  const body = {
    publishType: process.env.CWS_PUBLISH_TYPE || "DEFAULT_PUBLISH",
    skipReview: parseBooleanEnv("CWS_SKIP_REVIEW", false),
    blockOnWarnings: parseBooleanEnv("CWS_BLOCK_ON_WARNINGS", true),
  };

  if (deployPercentage !== undefined) {
    if (!Number.isInteger(deployPercentage) || deployPercentage < 0 || deployPercentage > 100) {
      throw new Error("CWS_DEPLOY_PERCENTAGE must be an integer between 0 and 100.");
    }
    body.deployInfos = [{ deployPercentage }];
  }

  const response = await fetch(publishUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return readJsonResponse(response, "Chrome Web Store publish");
}

async function main() {
  const zipPath = path.resolve(getArgValue("--zip", "release/extension.zip"));
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Package zip not found: ${zipPath}`);
  }

  const auth = {
    clientId: requireEnv("CWS_CLIENT_ID"),
    clientSecret: requireEnv("CWS_CLIENT_SECRET"),
    refreshToken: requireEnv("CWS_REFRESH_TOKEN"),
  };
  const publisherId = requireEnv("CWS_PUBLISHER_ID");
  const extensionId = requireEnv("CWS_EXTENSION_ID");

  console.log(`Publishing ${zipPath} to Chrome Web Store item ${extensionId}.`);
  const accessToken = await getAccessToken(auth);

  const upload = await uploadPackage({ accessToken, publisherId, extensionId, zipPath });
  console.log(`Upload response: ${JSON.stringify(upload, null, 2)}`);

  const uploadState = getUploadState(upload);
  if (isUploadInProgress(uploadState)) {
    await waitForUpload({ accessToken, publisherId, extensionId });
  } else if (uploadState && !isUploadSucceeded(uploadState)) {
    throw new Error(`Upload did not process successfully: ${uploadState}`);
  }

  const publish = await publishItem({ accessToken, publisherId, extensionId });
  console.log(`Publish response: ${JSON.stringify(publish, null, 2)}`);

  const status = await fetchStatus({ accessToken, publisherId, extensionId });
  console.log(`Current status: ${JSON.stringify(status, null, 2)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
