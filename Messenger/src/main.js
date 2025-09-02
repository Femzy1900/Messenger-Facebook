// main.js

import { Actor } from 'apify';

import { runMessenger } from './messenger.js';

// Start Apify Actor
await Actor.init();

const input = await Actor.getInput();

if (!input?.loginEmail || !input?.loginPassword) {
    throw new Error("❌ loginEmail and loginPassword are required in INPUT.json or Apify Console.");
}

console.log("🤖 Facebook Messenger Actor starting...");

// Ensure input structure matches messenger.js expectations
if (!input?.profiles || !Array.isArray(input.profiles) || input.profiles.length === 0) {
    throw new Error("profiles (array) required in INPUT.json or Apify Console.");
}
if (!input?.message) {
    throw new Error("message required in INPUT.json or Apify Console.");
}

const results = await runMessenger(input);

// Save results to Apify dataset
await Actor.pushData(results);

console.log("🎉 Done! Results pushed to dataset.");

// Graceful exit
await Actor.exit();
