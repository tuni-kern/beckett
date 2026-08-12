/**
 * Morning Briefing Example
 *
 * Sends a daily summary via Telegram at a scheduled time.
 * Customize this for your own morning routine.
 *
 * Schedule this with:
 * - macOS: launchd (see daemon/morning-briefing.plist)
 * - Linux: cron or systemd timer
 * - Windows: Task Scheduler
 *
 * Run manually: bun run examples/morning-briefing.ts
 */

import { spawnSync } from "child_process";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_USER_ID || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const GYM_GOAL = 2; // workouts per week

// ============================================================
// TELEGRAM HELPER
// ============================================================

async function sendTelegram(message: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message,
          parse_mode: "Markdown",
        }),
      }
    );

    return response.ok;
  } catch (error) {
    console.error("Telegram error:", error);
    return false;
  }
}

// ============================================================
// DATA FETCHERS (customize these for your sources)
// ============================================================

async function getUnreadEmails(): Promise<string> {
  // Example: Use Gmail API, IMAP, or MCP tool
  // Return a summary of unread emails

  // Placeholder - replace with your implementation
  return "- 3 unread emails (1 urgent from client)";
}

async function getCalendarEvents(): Promise<string> {
  // Example: Use Google Calendar API or MCP tool
  // Return today's events

  // Placeholder
  return "- 10:00 Team standup\n- 14:00 Client call";
}

async function getActiveGoals(): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return "";

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/memory?type=eq.goal&select=content,deadline,priority&order=priority.desc,deadline.asc`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!response.ok) return "";
    const goals = await response.json();

    if (!goals || goals.length === 0) {
      return "- No active goals set. Time to set one?";
    }

    return goals
      .map((g: any) => {
        let deadline = "";
        if (g.deadline) {
          const d = new Date(g.deadline);
          const now = new Date();
          const days = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (days > 0) {
            deadline = ` (${days}d left)`;
          }
        }
        return `- ${g.content}${deadline}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

async function getWeather(): Promise<string> {
  // Open-Meteo API (free, no key needed)
  // San Diego coordinates: 32.7157°N, 117.1611°W

  try {
    const response = await fetch(
      "https://api.open-meteo.com/v1/forecast?" +
      "latitude=32.7157&longitude=-117.1611&" +
      "current=temperature_2m,weather_code&" +
      "daily=temperature_2m_max,temperature_2m_min,weather_code&" +
      "temperature_unit=fahrenheit"
    );

    if (!response.ok) return "Unable to fetch weather";
    const data = await response.json();

    const current = data.current;
    const daily = data.daily;

    if (!current || !daily) return "Unable to fetch weather";

    // Weather code to description mapping (WMO codes)
    const weatherMap: { [key: number]: string } = {
      0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Overcast",
      45: "Foggy", 48: "Foggy",
      51: "Light Drizzle", 53: "Drizzle", 55: "Heavy Drizzle",
      61: "Light Rain", 63: "Rain", 65: "Heavy Rain",
      71: "Light Snow", 73: "Snow", 75: "Heavy Snow",
      77: "Snow Grains", 80: "Light Showers", 81: "Showers", 82: "Heavy Showers",
      85: "Light Snow Showers", 86: "Snow Showers",
      95: "Thunderstorm", 96: "Thunderstorm w/ Hail", 99: "Thunderstorm w/ Hail"
    };

    const condition = weatherMap[current.weather_code] || "Unknown";
    const temp = Math.round(current.temperature_2m);
    const high = Math.round(daily.temperature_2m_max[0]);
    const low = Math.round(daily.temperature_2m_min[0]);

    return `${condition}, ${temp}°F — High: ${high}°F, Low: ${low}°F`;
  } catch (error) {
    console.error("Weather fetch error:", error);
    return "Unable to fetch weather";
  }
}

async function getCompletedGoals(): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return "";

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/memory?type=eq.completed_goal&completed_at=gte.${sevenDaysAgo.toISOString()}&select=content,completed_at&order=completed_at.desc&limit=5`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!response.ok) return "";
    const goals = await response.json();

    if (!goals || goals.length === 0) return "";

    return goals
      .map((g: any) => `- ${g.content}`)
      .join("\n");
  } catch {
    return "";
  }
}

async function getAINews(): Promise<string> {
  // Fetch latest AI news from HN
  try {
    const response = await fetch("https://news.ycombinator.com/newest?p=1", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) return "";

    const html = await response.text();

    // Extract all story titles
    const titleRegex = /<span class="titleline"><a[^>]*href="([^"]*)"[^>]*>(.+?)<\/a>/g;
    const matches: Array<[string, string]> = [];
    let match;

    while ((match = titleRegex.exec(html)) !== null) {
      matches.push([match[1], match[2]]);
    }

    if (matches.length === 0) return "";

    // Get top stories (don't filter yet)
    const topStories = matches.slice(0, 15).map(([, title]) => title);

    // Filter for AI-related stories
    const aiStories = topStories.filter(
      (t) =>
        t.toLowerCase().includes("ai") ||
        t.toLowerCase().includes("llm") ||
        t.toLowerCase().includes("gpt") ||
        t.toLowerCase().includes("claude") ||
        t.toLowerCase().includes("machine learning") ||
        t.toLowerCase().includes("neural") ||
        t.toLowerCase().includes("transformer")
    );

    // Return up to 3 AI stories, or if none found, return top general stories
    const storiesToShow = aiStories.length > 0 ? aiStories.slice(0, 3) : topStories.slice(0, 3);

    if (storiesToShow.length === 0) return "";

    return storiesToShow.map((t) => `- ${t}`).join("\n");
  } catch (error) {
    console.error("News fetch error:", error);
    return "- Check latest AI news on news.ycombinator.com";
  }
}

async function getGymProgress(): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return "";

  const now = new Date();
  const day = now.getDay();
  const dayOfWeek = day === 0 ? 6 : day - 1; // 0=Mon, 6=Sun
  const daysLeft = 6 - dayOfWeek;

  try {
    // Get the most recent gym fact
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/memory?type=eq.fact&content=ilike.*gym*&order=created_at.desc&limit=1&select=content`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!response.ok) return `- Goal: ${GYM_GOAL}x/week (couldn't check progress)`;
    const data = await response.json();

    if (!data || data.length === 0) {
      return `- Goal: ${GYM_GOAL}x/week`;
    }

    // Parse the most recent gym fact for session count
    const gymFact = data[0].content;
    const match = gymFact.match(/(\d+)\s+(?:session|visit)/i);
    const visits = match ? parseInt(match[1]) : 0;
    const remaining = GYM_GOAL - visits;

    if (visits >= GYM_GOAL) {
      return `- ${visits}/${GYM_GOAL} sessions done — goal hit this week`;
    }

    if (remaining > 0 && daysLeft <= 2) {
      return `- ${visits}/${GYM_GOAL} sessions — ${remaining} more needed and only ${daysLeft} day${daysLeft === 1 ? "" : "s"} left this week`;
    }

    return `- ${visits}/${GYM_GOAL} sessions this week — ${remaining} more to go`;
  } catch {
    return `- Goal: ${GYM_GOAL}x/week`;
  }
}

async function getSiteAnalytics(): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return "";

  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    // Get total page views today
    const totalResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/page_views?created_at=gte.${startOfDay.toISOString()}&select=count=exact`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!totalResponse.ok) return "";
    const totalCount = totalResponse.headers.get("content-range");
    const views = totalCount ? parseInt(totalCount.split("/")[1]) : 0;

    if (views === 0) {
      return "- 0 visitors today";
    }

    // Get top referrer
    const referrerResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/page_views?created_at=gte.${startOfDay.toISOString()}&select=referrer&order=created_at.desc`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    if (!referrerResponse.ok) {
      return `- ${views} visitor${views === 1 ? "" : "s"} today`;
    }

    const referrers = await referrerResponse.json();
    const referrerMap: { [key: string]: number } = {};
    referrers.forEach((r: any) => {
      const ref = r.referrer || "direct";
      referrerMap[ref] = (referrerMap[ref] || 0) + 1;
    });

    const topReferrer = Object.entries(referrerMap).sort((a, b) => b[1] - a[1])[0];
    const topRef = topReferrer
      ? topReferrer[0] === "direct"
        ? "direct traffic"
        : topReferrer[0].replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
      : "direct traffic";

    return `- ${views} visitor${views === 1 ? "" : "s"} today (top source: ${topRef})`;
  } catch (error) {
    console.error("Analytics fetch failed:", error);
    return "";
  }
}

// ============================================================
// IMAGE PROMPT GENERATOR
// ============================================================

async function generateImagePrompt(article: string): Promise<string> {
  if (!article) return "";

  const prompt = `You are an expert image prompt writer for AI image generators like DALL-E, Midjourney, or BubbleBeam.

Based on this tech/AI opinion article, create a detailed, specific image prompt that visually captures the article's core theme and emotional tone.

ARTICLE:
${article}

REQUIREMENTS:
- One detailed, specific prompt (not multiple variations)
- 150-250 words, maximum clarity
- Include: visual style, composition, colors, lighting, mood
- Make it cinematic and compelling — suitable for LinkedIn/YouTube thumbnails
- Reference specific concepts from the article (if possible)
- End with a style modifier (e.g., "cinematic lighting, editorial illustration, 4K")

Output ONLY the image prompt itself. No intro text, no variations, no explanations.`;

  console.log("Generating image prompt...");
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== "CLAUDECODE")
  );
  const result = spawnSync(process.env.CLAUDE_PATH || "claude", ["-p", prompt], {
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 10,
    encoding: "utf8",
    env: cleanEnv,
  });

  if (result.error) {
    console.error("Claude CLI spawn error:", result.error);
    return "";
  }

  if (result.status !== 0) {
    console.error("Claude CLI stderr:", result.stderr);
    return "";
  }

  return result.stdout.trim();
}

// ============================================================
// DAILY OPINION ARTICLE
// ============================================================

async function fetchTopTechNews(): Promise<string> {
  try {
    const idsRes = await fetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json"
    );
    if (!idsRes.ok) return "";
    const ids: number[] = await idsRes.json();

    // Fetch details for top 30 stories in parallel
    const stories = await Promise.all(
      ids.slice(0, 30).map((id) =>
        fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
          .then((r) => r.json())
          .catch(() => null)
      )
    );

    const aiKeywords = [
      "ai", "llm", "gpt", "claude", "openai", "anthropic", "gemini",
      "machine learning", "neural", "model", "agent", "automation",
      "deepseek", "mistral", "meta", "google", "microsoft", "nvidia",
      "robot", "chatbot", "language model", "diffusion", "inference",
    ];

    // Filter for AI/tech relevant stories with meaningful score
    const aiStories = stories
      .filter((s) => s && s.title && s.score > 30)
      .filter((s) =>
        aiKeywords.some((k) => s.title.toLowerCase().includes(k))
      )
      .slice(0, 6);

    const storiesToUse =
      aiStories.length >= 2
        ? aiStories
        : stories
            .filter((s) => s && s.title && s.score > 100)
            .slice(0, 6);

    return storiesToUse
      .map(
        (s) =>
          `- ${s.title} (score: ${s.score})\n  ${s.url || `https://news.ycombinator.com/item?id=${s.id}`}`
      )
      .join("\n");
  } catch (error) {
    console.error("News fetch error:", error);
    return "";
  }
}

async function generateOpinionArticle(): Promise<string> {
  const news = await fetchTopTechNews();
  if (!news) {
    console.error("No news found, skipping opinion article");
    return "";
  }

  const prompt = `You are Beckett, the personal AI assistant of the user. Write a sharp daily tech opinion piece based on today's top AI/tech headlines.

TOP STORIES FROM HACKER NEWS:
${news}

Pick the SINGLE most newsworthy or provocative story and write a 400-500 word opinion article about it. If there's a strong angle connecting two stories, use that.

STYLE REQUIREMENTS (follow exactly):
- Open with a bold headline using a relevant emoji (🚨 💥 ⚡ 🔥) — make it punchy and provocative
- Second line: one crisp sentence stating the core fact with a specific detail (number, time, name)
- Use a timeline or sequence with emoji markers (⏰ 🔥 💰 🚫 💬 📉 📈) to walk through what happened
- Present at least 2 perspectives: "The cynical read:" and "The charitable read:" and "The uncomfortable reality:"
- End with a sharp rhetorical question that frames the bigger stakes
- Include 5-7 relevant hashtags (e.g. #OpenAI #AI #TechNews) at the very end
- Write in second/third person — not about the user, about the tech world
- NO intro like "Here's today's article" — output only the article itself

Write the article now.`;

  console.log("Generating opinion article via Claude CLI...");
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== "CLAUDECODE")
  );
  const result = spawnSync(process.env.CLAUDE_PATH || "claude", ["-p", prompt], {
    timeout: 90000,
    maxBuffer: 1024 * 1024 * 10,
    encoding: "utf8",
    env: cleanEnv,
  });

  if (result.error) {
    console.error("Claude CLI spawn error:", result.error);
    return "";
  }

  if (result.status !== 0) {
    console.error("Claude CLI stderr:", result.stderr);
    return "";
  }

  return result.stdout.trim();
}

// ============================================================
// BUILD BRIEFING
// ============================================================

async function buildBriefing(): Promise<string> {
  const now = new Date();
  // Format time in PT (UTC-8, or UTC-7 during DST)
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  });

  const sections: string[] = [];

  // Header
  sections.push(`🌅 **Good Morning!**\n${dateStr} @ ${timeStr} PT\n`);

  // Today's constraints
  const dayOfWeek = now.getDay();
  const isWeekday = dayOfWeek !== 0 && dayOfWeek !== 6;
  if (isWeekday) {
    // Customize this block with your own fixed commitments (or pull them
    // from a calendar integration).
    sections.push(`📍 **Today's Constraints**\n- 9:00-11:00 AM: Deep work block\n- 12:00 PM: Lunch + walk\n- 3:00 PM: School run\n- 4:00 PM+: Open\n`);
  }

  // Weather (optional)
  try {
    const weather = await getWeather();
    sections.push(`☀️ **Weather**\n${weather}\n`);
  } catch (e) {
    console.error("Weather fetch failed:", e);
  }

  // Calendar
  try {
    const calendar = await getCalendarEvents();
    if (calendar) {
      sections.push(`📅 **Today's Events**\n${calendar}\n`);
    }
  } catch (e) {
    console.error("Calendar fetch failed:", e);
  }

  // Emails
  try {
    const emails = await getUnreadEmails();
    if (emails) {
      sections.push(`📧 **Inbox**\n${emails}\n`);
    }
  } catch (e) {
    console.error("Email fetch failed:", e);
  }

  // Active Goals
  try {
    const goals = await getActiveGoals();
    if (goals) {
      sections.push(`🎯 **Active Goals**\n${goals}\n`);
    }
  } catch (e) {
    console.error("Goals fetch failed:", e);
  }

  // Completed Goals (this week)
  try {
    const completed = await getCompletedGoals();
    if (completed) {
      sections.push(`✅ **This Week's Wins**\n${completed}\n`);
    }
  } catch (e) {
    console.error("Completed goals fetch failed:", e);
  }

  // Gym progress
  try {
    const gym = await getGymProgress();
    if (gym) {
      sections.push(`💪 **Gym**\n${gym}\n`);
    }
  } catch (e) {
    console.error("Gym fetch failed:", e);
  }

  // Site analytics (add your domain here)
  try {
    const analytics = await getSiteAnalytics();
    if (analytics) {
      sections.push(`📊 **Beckett Site**\n${analytics}\n`);
    }
  } catch (e) {
    console.error("Analytics fetch failed:", e);
  }

  // AI News (optional)
  try {
    const news = await getAINews();
    if (news) {
      sections.push(`🤖 **AI News**\n${news}\n`);
    }
  } catch (e) {
    console.error("News fetch failed:", e);
  }

  // Footer
  sections.push("---\n_Ready to build. Let's go._");

  return sections.join("\n");
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("Building morning briefing...");

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_USER_ID");
    process.exit(1);
  }

  const briefing = await buildBriefing();

  console.log("Sending briefing...");
  const success = await sendTelegram(briefing);

  if (success) {
    console.log("Briefing sent successfully!");
  } else {
    console.error("Failed to send briefing");
    process.exit(1);
  }

  // Generate and send daily opinion article
  try {
    const article = await generateOpinionArticle();
    if (article) {
      console.log("Sending opinion article...");
      const articleSuccess = await sendTelegram(article);
      if (articleSuccess) {
        console.log("Opinion article sent successfully!");

        // Generate and send image prompt based on the article
        try {
          const imagePrompt = await generateImagePrompt(article);
          if (imagePrompt) {
            console.log("Sending image prompt...");
            const imagePromptMessage = `🎨 **Image Prompt for Today's Article**\n\n${imagePrompt}`;
            const promptSuccess = await sendTelegram(imagePromptMessage);
            if (promptSuccess) {
              console.log("Image prompt sent successfully!");
            } else {
              console.error("Failed to send image prompt");
            }
          }
        } catch (promptError) {
          console.error("Image prompt generation failed:", promptError);
        }
      } else {
        console.error("Failed to send opinion article");
      }
    }
  } catch (e) {
    console.error("Opinion article generation failed:", e);
  }
}

main();

// ============================================================
// LAUNCHD PLIST FOR SCHEDULING (macOS)
// ============================================================
/*
Save this as ~/Library/LaunchAgents/com.beckett.morning-briefing.plist:

<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.beckett.morning-briefing</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/YOUR_USERNAME/.bun/bin/bun</string>
        <string>run</string>
        <string>examples/morning-briefing.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/beckett</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/morning-briefing.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/morning-briefing.error.log</string>
</dict>
</plist>

Load with: launchctl load ~/Library/LaunchAgents/com.beckett.morning-briefing.plist
*/

// ============================================================
// CRON FOR SCHEDULING (Linux)
// ============================================================
/*
Add to crontab with: crontab -e

# Run at 9:00 AM every day
0 9 * * * cd /path/to/beckett && /home/USER/.bun/bin/bun run examples/morning-briefing.ts >> /tmp/morning-briefing.log 2>&1
*/
