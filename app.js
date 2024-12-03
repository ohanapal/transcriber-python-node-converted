const fs = require("fs");
const path = require("path");
const axios = require("axios");
const screenshot = require("screenshot-desktop");
const sharp = require("sharp");
const mic = require("mic");
const readline = require("readline");
const FormData = require("form-data");

// Constants
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const SCREENSHOT_INTERVAL = parseInt(process.env.SCREENSHOT_INTERVAL, 10) || 10000; // 10 seconds
let sessionFolder = "";
let monitors = [];
let maxSpeakers = 1;
let botId = "";
let screenshotIntervalId = null;
let audioFilename = "";

// Helper function to format timestamp as YYYYMMDD_HHMMSS
function formatTimestamp(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "_",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
}

const now = new Date();
const timestamp = formatTimestamp(now);
// Create session folder
function createSessionFolder() {

  sessionFolder = `session_${timestamp}`;
  fs.mkdirSync(sessionFolder, { recursive: true });
  console.log(`Created session folder: ${sessionFolder}`);
}

// Capture screenshot
async function captureScreenshot() {
  try {
    const availableMonitors = await screenshot.listDisplays();
    for (const monitorIndex of monitors) {
      if (monitorIndex < 0 || monitorIndex >= availableMonitors.length) {
        console.error(`Monitor ${monitorIndex + 1} is not available.`);
        continue;
      }
      const time = new Date();
      const pictureTimestamp = formatTimestamp(time);
      const monitor = availableMonitors[monitorIndex];
      const screenshotPath = path.join(
        sessionFolder,
        `screenshot_monitor_${monitorIndex + 1}_${pictureTimestamp}.jpg`,
      );

      const image = await screenshot({ screen: monitor.id });
      const compressedImage = await sharp(image)
        .resize(800) // Resize for compression
        .jpeg({ quality: 80 })
        .toBuffer();

      fs.writeFileSync(screenshotPath, compressedImage);
      console.log(`Screenshot saved: ${screenshotPath}`);
    }
  } catch (err) {
    console.error(`Failed to capture screenshot: ${err.message}`);
  }
}

// Start audio recording
function recordAudio() {
  const micInstance = mic({
    rate: "44100",
    channels: "1",
    fileType: "wav",
  });

  const micInputStream = micInstance.getAudioStream();

  audioFilename = path.join(sessionFolder, `audio_${timestamp}.wav`);
  const outputFileStream = fs.createWriteStream(audioFilename);

  micInputStream.pipe(outputFileStream);

  micInputStream.on("error", (err) => {
    console.error(`Audio stream error: ${err.message}`);
  });

  micInstance.start();
  console.log("Audio recording started.");

  process.on("SIGINT", () => {
    console.log("Stopping audio recording...");
    micInstance.stop();
    outputFileStream.end();
    console.log(`Audio saved: ${audioFilename}`);
    gracefulShutdown();
  });
}

// Upload captured audio and screenshots
async function uploadCapturedFiles() {

  try {
    // Upload screenshots
    const screenshotFormData = new FormData();

    // Append common data for both screenshots and audio
    screenshotFormData.append("bot_id", botId);
    screenshotFormData.append("current_time", timestamp);
    screenshotFormData.append("session_id", timestamp);

    // Loop through all .jpg files and append them to the FormData
    const files = fs.readdirSync(sessionFolder);
    files.forEach(file => {
      if (file.endsWith(".jpg")) {
        screenshotFormData.append("file", fs.createReadStream(path.join(sessionFolder, file)), file);
      }
    });
    // Send a single request with both images and audio
    const uploadResponse = await axios.post(
      `${SERVER_URL}/upload/image`,
      screenshotFormData,
      { headers: screenshotFormData.getHeaders() }
    );

    console.log(`Files uploaded successfully: ${uploadResponse.statusText}`);
    // Upload audio
    if (audioFilename) {
      console.log("audioFilename function is true")
      const audioFormData = new FormData();
      
      audioFormData.append("session_id", timestamp);
      audioFormData.append("max_speakers", maxSpeakers);
      audioFormData.append("bot_id", botId);
      audioFormData.append("file", fs.createReadStream(audioFilename));

      const audioResponse = await axios.post(
        `${SERVER_URL}/upload/audio`,
        audioFormData,
        { headers: audioFormData.getHeaders() }
      );
      console.log(`Audio uploaded: ${audioResponse.statusText}`);
    }

    
  } catch (err) {
    console.error(`Error uploading files: ${err.message}`);
  }
}

// Graceful shutdown
async function gracefulShutdown() {
  if (screenshotIntervalId) {
    clearInterval(screenshotIntervalId);
    console.log("Stopped screenshot capture.");
  }
  console.log("Stopping audio recording...");
  try {
    console.log("hitting the uploadCaturedfiles")
    await uploadCapturedFiles();
  } catch (err) {
    console.error(`Error during shutdown: ${err.message}`);
  }
  console.log("Gracefully shutting down...");
  process.exit();
}

// Start the script
async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Script started");
  const availableMonitors = await screenshot.listDisplays();
  console.log("Available monitors:");
  availableMonitors.forEach((monitor, index) => {
    console.log(
      `${index + 1}. ${monitor.name}: ${monitor?.bounds?.width}x${monitor?.bounds?.height}`,
    );
  });

  rl.question(
    "Enter the numbers of the monitors you want to capture (comma-separated), or 'all': ",
    (monitorInput) => {
      if (monitorInput.trim().toLowerCase() === "all") {
        monitors = availableMonitors.map((_, index) => index);
      } else {
        monitors = monitorInput
          .split(",")
          .map((num) => parseInt(num.trim(), 10) - 1);
      }

      rl.question("How many speakers? ", (speakersInput) => {
        maxSpeakers = parseInt(speakersInput.trim(), 10);

        rl.question("Enter the bot ID: ", (botInput) => {
          botId = botInput.trim();

          console.log(`Selected monitors: ${monitors}`);
          console.log(`Max speakers set to: ${maxSpeakers}`);
          console.log(`Bot ID set to: ${botId}`);

          createSessionFolder();
          console.log("Starting audio recording...");
          recordAudio();

          console.log("Starting screenshot capture...");
          screenshotIntervalId = setInterval(
            () => captureScreenshot(),
            SCREENSHOT_INTERVAL,
          );

          console.log("Press Ctrl+C to stop...");
          rl.close();
        });
      });
    },
  );
}

main();
