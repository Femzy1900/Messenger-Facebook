/**
 * Apify Facebook Messenger Actor
 *
 * Enhanced Puppeteer automation script for sending messages on Facebook Messenger
 * with automatic login handling, reCAPTCHA solving, and human-like interactions.
 *
 * Input Schema:
 * {
 *   "loginEmail": "your-email@example.com",
 *   "loginPassword": "your-password",
 *   "profiles": [
 *     {"id": "profile-001", "url": "https://www.facebook.com/username"},
 *     {"id": "profile-002", "url": "https://www.facebook.com/profile.php?id=123456"}
 *   ],
 *   "message": "Your message text here",
 *   "headless": true
 * }
 */

const { Actor } = require("apify");
const PuppeteerCrawler = require("crawlee");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
// import { PuppeteerCrawler } from 'crawlee';
// import puppeteer from 'puppeteer-extra';
// import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Use stealth plugin
puppeteer.use(StealthPlugin());

const DEFAULT_VIEWPORT = { width: 1366, height: 768 };

/* ---------------------------- Utility helpers ---------------------------- */

function rand(min = 100, max = 1000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    await element.click({ delay: rand(50, 150) });
  }
}

/* -------------------------- Cookie Persistence -------------------------- */

async function saveCookies(page, email) {
  const cookies = await page.cookies();
  await Actor.setValue(
    `cookies-${email.replace(/[^a-z0-9_\-\.@]/gi, "_")}`,
    cookies
  );
}

async function loadCookies(page, email) {
  const cookieKey = `cookies-${email.replace(/[^a-z0-9_\-\.@]/gi, "_")}`;
  const cookies = await Actor.getValue(cookieKey);

  if (cookies && Array.isArray(cookies)) {
    try {
      await page.setCookie(...cookies);
      return true;
    } catch (err) {
      console.warn("Failed to set cookies:", err.message);
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

    // For now, return false and let manual solving handle it
    console.log("⚠️ reCAPTCHA requires manual intervention");
    return false;
  } catch (error) {
    console.error("❌ reCAPTCHA audio solving failed:", error.message);
    return false;
  }
}

async function solveCaptcha(page, headless) {
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
  if (!headless) {
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
    // Wait for login form
      await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });
    
    // Fill email
    const emailField = await page.$('input[name="email"], input[type="email"]');
    if (emailField) {
      await humanClick(page, emailField);
      await delay(rand(300, 600));
      await humanType(emailField, email, { min: 80, max: 180 });
      await delay(rand(400, 800));
    } else {
      throw new Error('Email field not found');
    }

    // --- Fill password ---
    const passwordSelector = 'input[name="pass"], input[type="password"]';
    const passwordField = await page.$(passwordSelector);
    if (passwordField) {
      await humanClick(page, passwordField);            // ✅ click handle
      await delay(rand(300, 600));
      await humanType(passwordSelector, password, { min: 80, max: 180 }); // ✅ type selector
      await delay(rand(500, 1000));
    } else {
      throw new Error("Password field not found");
    }

    // --- Click login button ---
    const loginButton = await page.$(
      'button[name="login"], input[value="Log In"], [data-testid="royal_login_button"], button[type="submit"]'
    );
    if (loginButton) {
      await humanClick(page, loginButton); // ✅ handle
    } else {
      console.warn("⚠️ Login button not found, pressing Enter as fallback...");
      await page.keyboard.press("Enter");
    }

    console.log("⏳ Waiting for login to complete...");

    // --- Wait for navigation or login ---
    await Promise.race([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }),
      delay(5000), // FB sometimes AJAX refreshes without full navigation
    ]);

    await delay(rand(2000, 4000));

    // --- CAPTCHA check ---
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

    // --- Check success ---
    const stillOnLoginPage = await isLoginRequired(page);
    if (stillOnLoginPage) {
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

async function sendMessageToProfile(page, profile, message, email, headless) {
  const start = Date.now();
  let messageButtonPresent = "No";
  let messageSent = "No";

  try {
    console.log(`\n🎯 Processing profile: ${profile.id}`);
    console.log(`🔗 URL: ${profile.url}`);

    // Load cookies first to maintain session
    if (email) {
      await loadCookies(page, email);
    }

    // Navigate with retry mechanism
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

    // Check if login required
    const needsLogin = await isLoginRequired(page);
    if (needsLogin) {
      console.log("🔒 Login required, authenticating...");
      await performFacebookLogin(
        page,
        email,
        process.env.LOGIN_PASSWORD || "",
        headless
      );
      await saveCookies(page, email);

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
    const messageButtonSelector = 'div[aria-label="Message"][role="button"]';

    let messageButton = null;
    try {
      console.log("Trying primary message button selector...");
      messageButton = await page.$(messageButtonSelector);

      if (!messageButton) {
        throw new Error("Profile unavailable or no messaging option found");
      }

      console.log("🖱️ Clicking message button...");
      await humanClick(page, messageButton);
      messageButtonPresent = "Yes";

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
        'div[aria-label="Message"][role="textbox"][contenteditable="true"]',
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
          'div.xsrhx6k[role="button"]',
          "div.x5yr21d svg.xsrhx6k",
          'svg.xsrhx6k[aria-label="Send"]',
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
          messageSent = "Yes";
        } else {
          console.log("📤 Trying Enter key to send...");
          await page.keyboard.press("Enter");
          messageSent = "Yes";
        }

        await delay(rand(4000, 7000));
        console.log("✅ Message sent successfully!");
      } else {
        throw new Error("Message input field not found");
      }
    } catch (err) {
      throw new Error("Profile unavailable or no messaging option found");
    }

    const duration = Date.now() - start;
    return {
      success: true,
      profileId: profile.id,
      url: profile.url,
      durationMs: duration,
      message: message.substring(0, 50) + (message.length > 50 ? "..." : ""),
      messageButtonPresent,
      messageSent,
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
      messageButtonPresent,
      messageSent,
    };
  }
}

/* ------------------------------- Main Actor -------------------------------- */

Actor.main(async () => {
  console.log("🤖 Facebook Messenger Actor starting...");

  //   Get input from Apify
  // Get inputs from Apify or environment
  const input = (await Actor.getInput()) || {};
  console.log("Loaded input:", input);

  const loginEmail =
    "adedokunfemi14@gmail.com" || process.env.LOGIN_EMAIL || input.loginEmail;
  const loginPassword =
    "Adedokun@1900" || process.env.LOGIN_PASSWORD || input.loginPassword;
  const profiles = input.profiles || [
    { id: "profile-001", url: "https://www.facebook.com/terri.lopez.9659283" },
    {
      id: "profile-002",
      url: "https://www.facebook.com/profile.php?id=61559986547821",
    },
  ];
  const message = input.message || "Hello World";
  const headless = input.headless || false;

  // ✅ Validate resolved values
  if (!loginEmail || !loginPassword) {
    throw new Error(
      "❌ loginEmail and loginPassword are required inputs (via .env or INPUT.json)"
    );
  }

  if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
    throw new Error(
      "❌ profiles array is required and must contain at least one profile"
    );
  }

  if (!message || typeof message !== "string") {
    throw new Error("❌ message is required and must be a string");
  }

  //   const {
  //     loginEmail,
  //     loginPassword,
  //     profiles,
  //     message,
  //     headless = true,
  //   } = input;

  console.log(`📧 Login email: ${loginEmail}`);
  console.log(`📝 Message: "${message}"`);
  console.log(`👥 Profiles to process: ${profiles.length}`);
  console.log(`🤖 Headless mode: ${headless}`);

  // Launch browser with Apify's configuration
  const browser = await puppeteer.launch({
    headless,
    defaultViewport: DEFAULT_VIEWPORT,
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
      "--disable-images",
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
    slowMo: 50,
  });

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
    if (window.chrome && window.chrome.runtime) {
      delete window.chrome.runtime.onConnect;
    }

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
    console.log(`📋 Processing ${profiles.length} profiles...`);

    // First, try to establish a session by going to Facebook homepage
    console.log("🏠 Establishing Facebook session...");
    try {
      await page.goto("https://www.facebook.com", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await delay(rand(2000, 4000));

      // Load existing cookies if available
      await loadCookies(page, loginEmail);
      await page.reload({ waitUntil: "domcontentloaded" });
      await delay(rand(2000, 3000));
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

        const result = await sendMessageToProfile(
          page,
          profile,
          message,
          loginEmail,
          headless
        );

        // Save result to Apify dataset
        await Actor.pushData({
          timestamp: new Date().toISOString(),
          ...result,
        });

        results.push(result);
      } catch (err) {
        const fail = {
          success: false,
          profileId: profile.id,
          url: profile.url,
          error: err.message,
          timestamp: new Date().toISOString(),
          messageButtonPresent: "No",
          messageSent: "No",
        };

        await Actor.pushData(fail);
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

  // Summary
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log("\n" + "=".repeat(50));
  console.log("📊 FINAL RESULTS SUMMARY");
  console.log("=".repeat(50));
  console.log(`✅ Successful: ${successful}/${profiles.length}`);
  console.log(`❌ Failed: ${failed}/${profiles.length}`);

  if (failed > 0) {
    console.log("\n❌ Failed profiles:");
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(`   • ${r.profileId}: ${r.error}`);
      });
  }

  if (successful > 0) {
    console.log("\n✅ Successful profiles:");
    results
      .filter((r) => r.success)
      .forEach((r) => {
        console.log(`   • ${r.profileId}: ${Math.round(r.durationMs / 1000)}s`);
      });
  }

  console.log("\n🎉 Actor completed!");

  // Set final output
  await Actor.setValue("OUTPUT", {
    summary: {
      totalProfiles: profiles.length,
      successful,
      failed,
      successRate: `${Math.round((successful / profiles.length) * 100)}%`,
    },
    results,
  });
});
