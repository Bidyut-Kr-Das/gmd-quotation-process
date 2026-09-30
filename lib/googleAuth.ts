import { OAuth2Client, type Credentials } from "google-auth-library";
import fs from "fs";
import path from "path";

let oauth2ClientInstance: InstanceType<typeof OAuth2Client> | null = null;

/**
 * Initializes and returns the singleton OAuth2 client.
 * Reads config from credentials.json/token.json and persists token updates dynamically.
 */
export function getOAuthClient() {
  if (oauth2ClientInstance) {
    return oauth2ClientInstance;
  }

  const credentialsPath = path.join(process.cwd(), "credentials.json");
  const tokenPath = path.join(process.cwd(), "token.json");

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Missing credentials.json in project root. Expected path: ${credentialsPath}`);
  }
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`Missing token.json in project root. Expected path: ${tokenPath}`);
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  const tokenData = JSON.parse(fs.readFileSync(tokenPath, "utf8"));

  const clientInfo = credentials.installed || credentials.web;
  if (!clientInfo) {
    throw new Error("Invalid credentials.json format. Expected 'installed' or 'web' root key.");
  }

  const { client_id, client_secret, redirect_uris } = clientInfo;
  const redirectUri = redirect_uris && redirect_uris[0] ? redirect_uris[0] : "http://localhost";

  const oauth2Client = new OAuth2Client(
    client_id,
    client_secret,
    redirectUri
  );

  oauth2Client.setCredentials({
    access_token: tokenData.token || tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expiry_date: tokenData.expiry ? new Date(tokenData.expiry).getTime() : undefined,
    scope: tokenData.scopes ? tokenData.scopes.join(" ") : undefined,
  });

  oauth2Client.on("tokens", (tokens: Credentials) => {
    try {
      const currentTokenData = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
      const updatedTokenData = {
        ...currentTokenData,
        token: tokens.access_token || currentTokenData.token,
        refresh_token: tokens.refresh_token || currentTokenData.refresh_token,
        expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : currentTokenData.expiry,
      };
      fs.writeFileSync(tokenPath, JSON.stringify(updatedTokenData, null, 2), "utf8");
      console.log("Successfully refreshed and updated token.json with new OAuth2 access token.");
    } catch (err) {
      console.error("Failed to persist refreshed OAuth2 tokens to token.json:", err);
    }
  });

  oauth2ClientInstance = oauth2Client;

  return oauth2Client;
}
