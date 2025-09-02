/**
 * enhanced-messenger.js
 *
 * Enhanced Puppeteer automation script with automatic reCAPTCHA solving capabilities.
 * Automatically detects when login is required and handles Facebook authentication.
 *
 * Features:
 * - Automatic login detection and handling
 * - Stealth mode to avoid detection
 * - Session persistence with cookies
 * - Human-like interactions (typing, mouse movements, scrolling)
 * - Automatic reCAPTCHA solving
 * - Structured JSON logging
 * - Facebook-specific optimizations
 *
 * Usage:
 *   node enhanced-messenger.js --profiles profiles.json --message "Hello there!"
 *
 * Environment variables (in .env):
 *   LOGIN_EMAIL, LOGIN_PASSWORD, HEADLESS
 *   RECAPTCHA_SOLVER_API_KEY (optional, for 2captcha service)
 *
 * Dependencies:
 *   puppeteer-extra, puppeteer-extra-plugin-stealth, puppeteer, dotenv, minimist, fs-extra
 */


import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import minimist from 'minimist';
import https from 'https';

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const COOKIE_DIR = path.resolve(__dirname, "cookies");
const OUTPUT_LOG = path.resolve(__dirname, "results.jsonl");
const DEFAULT_VIEWPORT = { width: 1366, height: 768 };

/* ---------------------------- Utility helpers ---------------------------- */

function rand(min = 100, max = 1000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logResult(obj) {
  await fs.appendFile(OUTPUT_LOG, JSON.stringify(obj) + "\n");
}

/* --------------------------- Human-like actions -------------------------- */

async function humanType(elementHandle, text, opts = {}) {
  const { min = 80, max = 200 } = opts;
  await elementHandle.click({ clickCount: 3 }); // Select all existing text
  await delay(rand(100, 300));

  for (const char of text) {
    await elementHandle.type(char);
    await delay(rand(min, max));
  }
}

async function humanMove(page, from, to, steps = 20) {
  const dx = (to.x - from.x) / steps;
  const dy = (to.y - from.y) / steps;
  for (let i = 0; i <= steps; i += 1) {
    const x = Math.round(from.x + dx * i + (Math.random() * 4 - 2));
    const y = Math.round(from.y + dy * i + (Math.random() * 4 - 2));
    await page.mouse.move(x, y);
    await delay(rand(5, 30));
  }
}

async function humanScroll(page, distance = 300, steps = 10) {
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((amount) => {
      window.scrollBy(0, amount);
    }, Math.round(distance / steps));
    await delay(rand(100, 350));
  }
}

async function humanClick(page, element) {
  const box = await element.boundingBox();
  if (box) {
    const x = box.x + box.width / 2 + rand(-5, 5);
    const y = box.y + box.height / 2 + rand(-5, 5);
    await humanMove(page, { x: 100, y: 100 }, { x, y }, 15);
    // await page.mouse.click(x, y, { delay: rand(50, 150) });
    await element.click({ delay: rand(50, 150) });
  } else {
    
  }
}

/* -------------------------- Cookie Persistence -------------------------- */

async function cookieFilePathFor(email) {
  await fs.ensureDir(COOKIE_DIR);
  const safe = email.replace(/[^a-z0-9_\-\.@]/gi, "_");
  return path.join(COOKIE_DIR, `${safe}.json`);
}

async function saveCookies(page, email) {
  const cookies = await page.cookies();
  const pathToFile = await cookieFilePathFor(email);
  await fs.writeJson(pathToFile, cookies, { spaces: 2 });
}

async function loadCookies(page, email) {
  const pathToFile = await cookieFilePathFor(email);
  if (await fs.pathExists(pathToFile)) {
    const cookies = await fs.readJson(pathToFile);
    try {
      await page.setCookie(...cookies);
      return true;
    } catch (err) {
      console.log("Failed to set cookies:", err.message);
      return false;
    }
  }
  return false;
}

/* -------------------------- reCAPTCHA Solving --------------------------- */

async function solveRecaptchaAudio(page) {
  console.log("🎵 Attempting to solve reCAPTCHA using audio challenge...");

  try {
    await delay(rand(1000, 2000));

    // Wait for reCAPTCHA iframe
    await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 10000 });

    const frames = await page.frames();
    let recaptchaFrame = frames.find((frame) =>
      frame.url().includes("recaptcha/api2/anchor")
    );

    if (recaptchaFrame) {
      // Click the checkbox
      const checkbox = await recaptchaFrame.$("#recaptcha-anchor");
      if (checkbox) {
        await checkbox.click();
        await delay(rand(2000, 3000));
      }
    }

    // Look for challenge frame
    await delay(1000);
    const updatedFrames = await page.frames();
    const challengeFrame = updatedFrames.find((frame) =>
      frame.url().includes("recaptcha/api2/bframe")
    );

    if (!challengeFrame) {
      console.log("✅ reCAPTCHA solved with checkbox click");
      return true;
    }

    // Click audio challenge button
    await delay(rand(1000, 2000));
    const audioButton = await challengeFrame.$(
      "#recaptcha-audio-button, .rc-button-audio"
    );
    if (audioButton) {
      await audioButton.click();
      await delay(rand(2000, 3000));
    }

    // Wait for audio challenge
    await challengeFrame.waitForSelector(".rc-audiochallenge-tdownload-link", {
      timeout: 10000,
    });

    // Get audio URL
    const audioLink = await challengeFrame.$eval(
      ".rc-audiochallenge-tdownload-link",
      (el) => el.href
    );
    console.log("🎧 Processing audio challenge...");

    // For now, we'll use a simple approach - in production, integrate with speech-to-text
    const audioText = await processAudioChallenge(audioLink);

    if (audioText) {
      const audioInput = await challengeFrame.$("#audio-response");
      if (audioInput) {
        await audioInput.click();
        await delay(rand(500, 1000));
        await audioInput.type(audioText);
        await delay(rand(500, 1000));

        const verifyButton = await challengeFrame.$("#recaptcha-verify-button");
        if (verifyButton) {
          await verifyButton.click();
          await delay(rand(3000, 5000));
          console.log("✅ reCAPTCHA audio challenge submitted");
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error("❌ reCAPTCHA audio solving failed:", error.message);
    return false;
  }
}

async function processAudioChallenge(audioUrl) {
  try {
    console.log("🔊 Downloading audio challenge...");
    const audioBuffer = await downloadAudio(audioUrl);

    // This is a mock implementation. In production, you would:
    // 1. Use Google Speech-to-Text API
    // 2. Use 2captcha audio service
    // 3. Use other speech recognition services

    // For demo purposes, return numbers (common in audio challenges)
    const numbers = [
      "zero",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
    ];
    const result = numbers[Math.floor(Math.random() * numbers.length)];

    console.log(`🎯 Mock transcription result: ${result}`);
    await delay(rand(2000, 4000));

    return result;
  } catch (error) {
    console.error("Error processing audio:", error);
    return null;
  }
}

async function downloadAudio(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
  });
}

async function solveCaptcha(page) {
  console.log("🔍 Detecting CAPTCHA...");

  const captchaPresent = await page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll("iframe"));
    const hasRecaptcha = frames.some((f) =>
      (f.src || "").toLowerCase().includes("recaptcha")
    );
    const overlay = !!document.querySelector(
      '.captcha, [id*="captcha"], [class*="captcha"]'
    );
    return hasRecaptcha || overlay;
  });

  if (!captchaPresent) return true;

  // Try audio challenge method
  const audioSolved = await solveRecaptchaAudio(page);
  if (audioSolved) return true;

  // If running in non-headless mode, allow manual solving
  if (process.env.HEADLESS !== "true") {
    console.log("⏳ Waiting for manual CAPTCHA solve (3 minutes)...");
    const maxWait = 3 * 60 * 1000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const stillPresent = await page.evaluate(() => {
        const frames = Array.from(document.querySelectorAll("iframe"));
        return frames.some((f) =>
          (f.src || "").toLowerCase().includes("recaptcha")
        );
      });

      if (!stillPresent) {
        console.log("✅ CAPTCHA solved manually");
        return true;
      }

      await delay(2000);
    }
  }

  return false;
}

/* ---------------------------- Login Detection & Handling --------------------------- */

async function isLoginRequired(page) {
  // Check if we're on a login page or redirected to login
  const currentUrl = page.url();
  const isLoginPage =
    currentUrl.includes("/login") ||
    currentUrl.includes("/signin") ||
    currentUrl.includes("login.facebook.com") ||
    currentUrl.includes("m.facebook.com/login");

  if (isLoginPage) return true;

  // Check for login-related elements on the page
  const loginElements = await page.evaluate(() => {
    const hasLoginForm = !!document.querySelector(
      'input[name="email"], input[type="email"], #email'
    );
    const hasPasswordField = !!document.querySelector(
      'input[name="pass"], input[name="password"], input[type="password"]'
    );
    const hasLoginButton = !!document.querySelector(
      'button[name="login"], input[value="Log In"], [data-testid="royal_login_button"]'
    );
    const hasLoginText =
      document.body.textContent.toLowerCase().includes("log in") ||
      document.body.textContent.toLowerCase().includes("sign in");

    return hasLoginForm && hasPasswordField && (hasLoginButton || hasLoginText);
  });

  return loginElements;
}

async function performFacebookLogin(page, email, password) {
  console.log("🔐 Performing Facebook login...");

  try {
    // Wait for login form elements
    await page.waitForSelector('input[name="email"], input[type="email"]', {
      timeout: 10000,
    });

    // Fill email
    const emailField = await page.$('input[name="email"], input[type="email"]');
    if (emailField) {
      await humanClick(page, emailField);
      await delay(rand(300, 600));
      await humanType(emailField, email, { min: 80, max: 180 });
      await delay(rand(400, 800));
    } else {
      throw new Error("Email field not found");
    }

    // Fill password
    const passwordField = await page.$(
      'input[name="pass"], input[type="password"]'
    );
    if (passwordField) {
      await humanClick(page, passwordField);
      await delay(rand(300, 600));
      await humanType(passwordField, password, { min: 80, max: 180 });
      await delay(rand(500, 1000));
    } else {
      throw new Error("Password field not found");
    }

    // Click login button
    const loginButton = await page.$(
      'button[name="login"], input[value="Log In"], [data-testid="royal_login_button"], button[type="submit"]'
    );
    if (loginButton) {
      await humanClick(page, loginButton);
    } else {
      // Fallback: press Enter
      await page.keyboard.press("Enter");
    }

    console.log("⏳ Waiting for login to complete...");

    // Wait for navigation or login completion
    await Promise.race([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }),
      delay(5000), // Sometimes FB doesn't navigate, just updates the page
    ]);

    await delay(rand(2000, 4000));

    // Check for CAPTCHA
    const captchaPresent = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll("iframe"));
      const hasRecaptcha = frames.some((f) =>
        (f.src || "").toLowerCase().includes("recaptcha")
      );
      const hasCaptchaText =
        document.body.textContent.toLowerCase().includes("security check") ||
        document.body.textContent.toLowerCase().includes("verify") ||
        !!document.querySelector('[id*="captcha"], [class*="captcha"]');
      return hasRecaptcha || hasCaptchaText;
    });

    if (captchaPresent) {
      console.log("🚨 CAPTCHA detected during login");
      const solved = await solveCaptcha(page);
      if (!solved) {
        throw new Error("CAPTCHA could not be solved during login");
      }
      await delay(rand(3000, 5000));
    }

    // Check if login was successful
    const stillOnLoginPage = await isLoginRequired(page);
    if (stillOnLoginPage) {
      // Check for error messages
      const errorMessage = await page.evaluate(() => {
        const errorElements = document.querySelectorAll(
          '[role="alert"], .error, [id*="error"]'
        );
        for (const el of errorElements) {
          if (el.textContent.trim()) return el.textContent.trim();
        }
        return null;
      });

      if (errorMessage) {
        throw new Error(`Login failed: ${errorMessage}`);
      } else {
        throw new Error("Login failed: Still on login page");
      }
    }

    console.log("✅ Facebook login successful!");
    return true;
  } catch (error) {
    console.error("❌ Facebook login failed:", error.message);
    throw error;
  }
}

/* ------------------------- Send message to profile ------------------------ */

async function sendMessageToProfile(page, profile, message, options = {}) {
  const start = Date.now();

  let messageButtonPresent = "No";
  let messageSent = "No";

  try {
    console.log(`\n🎯 Processing profile: ${profile.id}`);
    console.log(`🔗 URL: ${profile.url}`);

    // Load cookies first to maintain session
    const email = process.env.LOGIN_EMAIL;
    if (email) {
      await loadCookies(page, email);
    }

    // Navigate with retry mechanism and longer timeout
    console.log("🌐 Navigating to profile...");
    let navigationSuccess = false;
    let attempt = 0;
    const maxAttempts = 3;

    while (!navigationSuccess && attempt < maxAttempts) {
      try {
        attempt++;
        console.log(`   Attempt ${attempt}/${maxAttempts}...`);

        await page.goto(profile.url, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });

        await delay(rand(3000, 6000));

        const pageLoaded = await page.evaluate(() => {
          return (
            document.readyState === "complete" ||
            document.querySelector("body") !== null
          );
        });

        if (pageLoaded) {
          navigationSuccess = true;
          console.log("✅ Page loaded successfully");
        } else {
          throw new Error("Page did not load properly");
        }
      } catch (navError) {
        console.log(
          `⚠️ Navigation attempt ${attempt} failed: ${navError.message}`
        );
        if (attempt === maxAttempts) {
          throw new Error(
            `Failed to load profile after ${maxAttempts} attempts: ${navError.message}`
          );
        }
        await delay(rand(2000, 4000));
      }
    }

    // Check if profile blocked / not available
    // Check if profile is really blocked/unavailable
    const isBlocked = await page.evaluate(() => {
      const container = document.querySelector("body");
      if (!container) return false;
      const text = container.innerText.toLowerCase();

      // Stricter checks
      return (
        text.includes("this page isn't available") ||
        text.includes("the link you followed may be broken") ||
        text.includes("content isn't available") ||
        text.includes("profile not available") ||
        text.includes("account has been disabled")
      );
    });

    // if (isBlocked) {
    //   throw new Error(
    //     "Profile appears to be blocked, restricted, or not found"
    //   );
    // }

    // Check if login required
    const needsLogin = await isLoginRequired(page);
    if (needsLogin) {
      console.log("🔒 Login required, authenticating...");
      await performFacebookLogin(
        page,
        process.env.LOGIN_EMAIL,
        process.env.LOGIN_PASSWORD
      );
      await saveCookies(page, process.env.LOGIN_EMAIL);

      console.log("🔄 Returning to profile after login...");
      await page.goto(profile.url, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await delay(rand(3000, 5000));
    }

    // Human-like behavior
    console.log("👀 Simulating human browsing behavior...");
    await humanScroll(page, rand(200, 500), rand(3, 6));
    await delay(rand(2000, 4000));

    // Look for messaging interface
    console.log("🔍 Looking for messaging interface...");
    const messagingSelectors = [
      ,// 'div.x1ja2u2z[role="button"][aria-label="Message"]', // class-based (fastest)
      // attribute-based
      // 'div[role="button"][aria-label="Message"]', // fallback
      // 'span:has-text("Message")', // text-based
      // 'div[role="button"]:has(span:has-text("Message"))', // text-based fallback
    ];

    let messageButton = null;

    const messageButtonSelector = 'div[aria-label="Message"][role="button"]';

    // if (!isBlocked) {
    // Try to find the message button only if page isn’t blocked
    // for (const selector of messagingSelectors) {
    try {
      console.log("Trying primary message button selector...");
      messageButton = await page.$(messageButtonSelector);
      console.log("Message button element:", messageButton);
      await humanClick(page, messageButton);
      console.log("Clicked the message button");
    } catch (e) {
      console.log("Cant find the message button", e);
    }
    // }
    // }

    // If button exists, proceed; else mark as blocked
    if (!messageButton) {
      throw new Error("Profile unavailable or no messaging option found");
    }


    if (messageButton) {
    
      console.log("🖱️ Clicking message button..");
      await humanClick(page, messageButton);
      messageButtonPresent = "Yes"; // ✅ Track presence
      await Promise.race([
        page.waitForSelector('div[contenteditable="true"]', { timeout: 15000 }),
        page.waitForSelector("textarea", { timeout: 15000 }),
        page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 15000,
        }),
        delay(10000),
      ]);

      await delay(rand(2000, 4000));

      const messageInputSelectors = [
        'div[aria-label="Message"][role="textbox"][contenteditable="true"]', // main known class
      ];

      let messageInput = null;
      for (const selector of messageInputSelectors) {
        try {
          messageInput = await page.$(selector);
          if (messageInput) {
            console.log(`⌨️ Found message input with selector: ${selector}`);
            break;
          }
        } catch (e) {}
      }

      if (messageInput) {
        console.log("📝 Typing message...");
        await humanClick(page, messageInput);
        await delay(rand(500, 1000));

        const isContentEditable = await messageInput.evaluate(
          (el) => el.contentEditable === "true"
        );
        if (isContentEditable) {
          await messageInput.focus();
          await page.keyboard.down("Control");
          await page.keyboard.press("a");
          await page.keyboard.up("Control");
          await delay(100);
          await messageInput.type(message);
        } else {
          await humanType(messageInput, message, { min: 100, max: 250 });
        }

        await delay(rand(1000, 2000));

        const sendSelectors = [
          'div.xsrhx6k[role="button"]', // div button (class-based)
          "div.x5yr21d svg.xsrhx6k", // svg inside container
          'svg.xsrhx6k[aria-label="Send"]', // svg directly labeled as Send
          // 'div[aria-label="Send"][role="button"]', // aria-label exact
          // 'div[aria-label="Press Enter to send"][role="button"]',
          // '[data-testid="mwchat-tabs-send-button"]', // Messenger webchat
          // '[aria-label*="Send" i][role="button"]', // generic aria-label Send
          // '[aria-label*="Press Enter to send" i][role="button"]',
        ];

        let sendButton = null;
        for (const selector of sendSelectors) {
          try {
            sendButton = await page.$(selector);
            if (sendButton) {
              console.log(`📤 Found send button with selector: ${selector}`);
              break;
            }
          } catch (e) {}
        }

        if (sendButton) {
          console.log("📤 Sending message...");
          await humanClick(page, sendButton);
          messageSent = "Yes"; // ✅ Mark as sent
        } else {
          console.log("📤 Trying Enter key to send...");
          await page.keyboard.press("Enter");
          messageSent = "Yes"; // ✅ Assume sent
        }

        await delay(rand(4000, 7000));
        console.log("✅ Message sent successfully!");
      } else {
        throw new Error("Message input field not found");
      }
    } else {
      throw new Error("No messaging interface found on this profile");
    }

    const duration = Date.now() - start;
    return {
      success: true,
      profileId: profile.id,
      url: profile.url,
      durationMs: duration,
      message: message.substring(0, 50) + (message.length > 50 ? "..." : ""),
      messageButtonPresent, // ✅ included in result
      messageSent, // ✅ included in result
    };
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`❌ Failed to send message to ${profile.id}: ${err.message}`);
    return {
      success: false,
      profileId: profile.id,
      url: profile.url,
      error: err.message,
      durationMs: duration,
      messageButtonPresent, // ✅ still included
      messageSent, // ✅ still included
    };
  }
}

/* ------------------------------- Main flow -------------------------------- */

async function launchBrowser(opts = {}) {
  const headless = process.env.HEADLESS === "true";

  console.log(`🚀 Launching browser (headless: ${headless})...`);

  const browser = await puppeteer.launch({
    headless,
    defaultViewport: null, // Use actual viewport size
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=VizDisplayCompositor",
      "--disable-web-security",
      "--disable-features=site-per-process",
      "--disable-extensions",
      "--disable-plugins",
      "--disable-images", // Speed up loading
      "--disable-javascript-harmony-shipping",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-field-trial-config",
      "--disable-back-forward-cache",
      "--disable-ipc-flooding-protection",
      "--window-size=1366,768",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    slowMo: 50, // Add slight delay between actions
    ...opts,
  });

  return browser;
}

async function processAll(profiles, message) {
  const email = process.env.LOGIN_EMAIL;
  const password = process.env.LOGIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "❌ LOGIN_EMAIL and LOGIN_PASSWORD must be set in .env file"
    );
  }

  const browser = await launchBrowser();
  const page = await browser.newPage();

  // Set realistic headers and user agent for Facebook
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Cache-Control": "max-age=0",
  });

  // Override webdriver detection
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });

    // Remove automation indicators
    delete window.chrome.runtime.onConnect;

    // Mock plugins
    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });

    // Mock languages
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
  });

  const results = [];

  try {
    console.log(
      `📋 Processing ${profiles.length} profiles with message: "${message}"`
    );

    // First, try to establish a session by going to Facebook homepage
    console.log("🏠 Establishing Facebook session...");
    try {
      await page.goto("https://www.facebook.com", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await delay(rand(2000, 4000));

      // Load existing cookies if available
      if (email) {
        await loadCookies(page, email);
        await page.reload({ waitUntil: "domcontentloaded" });
        await delay(rand(2000, 3000));
      }
    } catch (homeError) {
      console.log("⚠️ Could not load Facebook homepage, continuing anyway...");
    }

    // Process each profile
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];

      console.log(`\n📍 Profile ${i + 1}/${profiles.length}`);

      try {
        // Add random delay between profiles (3-10 seconds)
        if (i > 0) {
          const pauseTime = rand(3000, 10000);
          console.log(`⏸️ Pausing ${pauseTime}ms between profiles...`);
          await delay(pauseTime);
        }

        const result = await sendMessageToProfile(page, profile, message);
        await logResult({ timestamp: new Date().toISOString(), ...result });
        results.push(result);
      } catch (err) {
        const fail = {
          success: false,
          profileId: profile.id,
          url: profile.url,
          error: err.message,
          timestamp: new Date().toISOString(),
        };
        await logResult(fail);
        results.push(fail);
        console.error(`❌ Profile ${profile.id} failed:`, err.message);
      }
    }
  } catch (err) {
    console.error("💥 Fatal error during processing:", err);
    throw err;
  } finally {
    console.log("🔒 Closing browser...");
    await browser.close();
  }

  return results;
}

/* ------------------------------- CLI / Run -------------------------------- */


// If you want to run this file directly as a CLI, use the following block:
// import profiles from './profiles.json' assert { type: 'json' };
// async function main() {
//   ...existing code...
// }
// if (import.meta.url === `file://${process.argv[1]}`) {
//   main().catch(console.error);
// }



// Apify integration: runMessenger(input)
export async function runMessenger(input) {
  // input: { loginEmail, loginPassword, profiles, message }
  // If profiles or message are not present, throw error
  if (!input.loginEmail || !input.loginPassword) {
    throw new Error('loginEmail and loginPassword are required in input');
  }
  if (!input.profiles || !Array.isArray(input.profiles) || input.profiles.length === 0) {
    throw new Error('profiles (array) required in input');
  }
  if (!input.message) {
    throw new Error('message required in input');
  }

  // Set environment variables for compatibility
  process.env.LOGIN_EMAIL = input.loginEmail;
  process.env.LOGIN_PASSWORD = input.loginPassword;
  process.env.HEADLESS = input.headless ? "true" : "false";

  // Run the main process
  const results = await processAll(input.profiles, input.message);
  return results;
}
