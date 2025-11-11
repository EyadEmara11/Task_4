import http from 'http';
import mongoose from 'mongoose';
import crypto from 'crypto';

import app from '../src/app.js';
import { connectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';

// Helper to spin up the Express application on an ephemeral port so that the
// tests exercise the real HTTP stack exactly as a user would.
async function startHttpServer() {
  return new Promise((resolve) => {
    const instance = http.createServer(app);
    instance.listen(0, () => resolve(instance));
  });
}

describe('Authentication controller integration', () => {
  const uniqueSuffix = crypto.randomUUID();
  const credentials = {
    name: `Test Runner ${uniqueSuffix}`,
    email: `test.runner.${uniqueSuffix}@example.com`,
    password: `P@ssw0rd-${uniqueSuffix.slice(0, 8)}`
  };

  let serverInstance;
  let baseUrl;
  let issuedToken;

  beforeAll(async () => {
    await connectDB();
    // Guarantee a clean slate for the email we are about to register.
    await User.deleteOne({ email: credentials.email.toLowerCase() });

    serverInstance = await startHttpServer();
    const { port } = serverInstance.address();
    baseUrl = `http://127.0.0.1:${port}/api`;
  });

  afterAll(async () => {
    // Remove the test artefacts so the live database stays tidy for future runs.
    await User.deleteOne({ email: credentials.email.toLowerCase() });

    await new Promise((resolve) => serverInstance.close(resolve));
    await mongoose.connection.close();
  });

  test('registers a brand-new user and returns a JWT for immediate use', async () => {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });

    const payload = await response.json();

    // Successful registration should return 201 alongside a token and the
    // public portion of the newly saved user record.
    expect(response.status).toBe(201);
    expect(payload.token).toBeTruthy();
    expect(payload.user.email).toBe(credentials.email.toLowerCase());
    expect(payload.user).not.toHaveProperty('passwordHash');

    issuedToken = payload.token;
  });

  test('authenticates the same user and issues a fresh JWT', async () => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password
      })
    });

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.token).toBeTruthy();
    expect(payload.user.email).toBe(credentials.email.toLowerCase());
    expect(payload.user).not.toHaveProperty('passwordHash');

    issuedToken = payload.token;
  });

  test('returns the public profile for the currently authenticated user', async () => {
    const response = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${issuedToken}` }
    });

    const payload = await response.json();

    // A valid token must yield the sanitized user profile.
    expect(response.status).toBe(200);
    expect(payload.user.email).toBe(credentials.email.toLowerCase());
    expect(payload.user).not.toHaveProperty('passwordHash');
  });
});
