import { analyze } from 'https://esm.sh/web-audio-beat-detector';
import Meyda from 'https://esm.sh/meyda';

// A more robust, stateful beat detection class
class BeatDetector {
    constructor(historySize = 20, thresholdMultiplier = 1.5) {
        this.historySize = historySize;
        this.thresholdMultiplier = thresholdMultiplier;
        this.energyHistory = [];
        this.lastBeatTime = 0;
    }
    isBeat(currentEnergy, cooldown) {
        if (Date.now() - this.lastBeatTime < cooldown) return 0;
        if (this.energyHistory.length < this.historySize) {
            this.energyHistory.push(currentEnergy);
            return 0;
        }
        const mean = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
        const stdDev = Math.sqrt(
            this.energyHistory.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / this.energyHistory.length
        );
        const threshold = mean + stdDev * this.thresholdMultiplier;
        this.energyHistory.shift();
        this.energyHistory.push(currentEnergy);
        if (currentEnergy > threshold) {
            this.lastBeatTime = Date.now();
            return currentEnergy - threshold;
        }
        return 0;
    }
}

async function playSound() {
    try {
        const audioElement = new Audio('./hit.mp3');
        audioElement.volume = 1
        audioElement.preload = 'auto';
        await audioElement.play();
        audioElement.onended = () => audioElement.remove();
    } catch (error) {
        console.warn('Audio playback prevented or failed:', error);
    }
}

window.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elements ---
    const audioFileInput = document.getElementById('audio-file');
    const playButton = document.getElementById('play-button');
    const visualizationContainer = document.getElementById('visualization');
    const manualTriggerButton = document.getElementById('manual-trigger-button');
    const filterSelect = document.getElementById('filter-select');
    const backgroundCanvas = document.getElementById('background-canvas');
    const ctx = backgroundCanvas.getContext('2d');

    // Sliders & Value Displays
    const sensitivitySlider = document.getElementById('sensitivity-slider');
    const sensitivityValue = document.getElementById('sensitivity-value');
    const cooldownSlider = document.getElementById('cooldown-slider');
    const cooldownValue = document.getElementById('cooldown-value');
    const scaleSlider = document.getElementById('scale-slider');
    const scaleValue = document.getElementById('scale-value');
    const durationSlider = document.getElementById('duration-slider');
    const durationValue = document.getElementById('duration-value');

    // --- Core Settings Object ---
    const settings = {
        sensitivity: 1, cooldownMultiplier: 1.0, maxScale: 10, animationDuration: 3000,
    };

    // --- Audio & Analysis State ---
    let audioContext, audioBuffer, sourceNode;
    let bassMeyda, midsMeyda, overallMeyda;
    let isPlaying = false;
    let detectedBpm = 120;
    let dynamicCooldown = 250;
    let bassDetector = new BeatDetector(30, settings.sensitivity);
    let midsDetector = new BeatDetector(20, settings.sensitivity * 4);

    // --- Background Effect State ---
    let smoothedLoudness = 0;
    const SMOOTHING_FACTOR = 0.05;
    let backgroundPulse = 0;
    const PULSE_DECAY_FACTOR = 0.95;
    let animationFrameId;
    // *** NEW: State for the fade-out logic ***
    let lastBeatTimestamp = 0;
    const FADE_START_TIME = 1000;   // Wait 1 second before starting to fade
    const FADE_DURATION = 1500;     // Fade out over 1.5 seconds


    // --- Initialization ---
    function initializeUI() {
        sensitivitySlider.value = settings.sensitivity;
        sensitivityValue.textContent = settings.sensitivity.toFixed(2);
        cooldownSlider.value = settings.cooldownMultiplier;
        cooldownValue.textContent = settings.cooldownMultiplier.toFixed(2) + 'x';
        scaleSlider.value = settings.maxScale;
        scaleValue.textContent = settings.maxScale;
        durationSlider.value = settings.animationDuration;
        durationValue.textContent = settings.animationDuration;
        setupCanvas();
        window.addEventListener('resize', setupCanvas);
    }

    // --- UI Event Listeners ---
    sensitivitySlider.addEventListener('input', (e) => {
        settings.sensitivity = parseFloat(e.target.value);
        sensitivityValue.textContent = settings.sensitivity.toFixed(2);
        bassDetector.thresholdMultiplier = settings.sensitivity;
        midsDetector.thresholdMultiplier = settings.sensitivity * 1.2;
    });
    cooldownSlider.addEventListener('input', (e) => {
        settings.cooldownMultiplier = parseFloat(e.target.value);
        cooldownValue.textContent = settings.cooldownMultiplier.toFixed(2) + 'x';
    });
    scaleSlider.addEventListener('input', (e) => {
        settings.maxScale = parseInt(e.target.value, 10);
        scaleValue.textContent = settings.maxScale;
    });
    durationSlider.addEventListener('input', (e) => {
        settings.animationDuration = parseInt(e.target.value, 10);
        durationValue.textContent = settings.animationDuration;
    });
    manualTriggerButton.addEventListener('click', () => {
        createBeatCircle();
        spawnRandomTriangles(5);
        triggerBackgroundPulse(10);
    });
    audioFileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (audioContext) await audioContext.close();
        visualizationContainer.innerHTML = '';
        isPlaying = false;
        sourceNode = null;
        playButton.textContent = 'Play';
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const reader = new FileReader();
        reader.onload = (e) => {
            audioContext.decodeAudioData(e.target.result, (buffer) => {
                audioBuffer = buffer;
                playButton.disabled = false;
            });
        };
        reader.readAsArrayBuffer(file);
    });
    playButton.addEventListener('click', async () => {
        if (!audioBuffer) return;
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
            isPlaying = true;
            playButton.textContent = 'Pause';
            lastBeatTimestamp = Date.now(); // *** MODIFIED: Reset timer on play ***
            startVisualization();
            return;
        }
        if (isPlaying) {
            await audioContext.suspend();
            isPlaying = false;
            playButton.textContent = 'Play';
            stopVisualization();
            return;
        }
        playButton.disabled = true;
        playButton.textContent = 'Analyzing...';
        try {
            const tempo = await analyze(audioBuffer);
            detectedBpm = Math.round(tempo);
            const quarterNoteDuration = (60 / detectedBpm) * 1000;
            dynamicCooldown = quarterNoteDuration / 2;
            playAudioAndAnalyze();
            isPlaying = true;
            playButton.textContent = 'Pause';
            playButton.disabled = false;
        } catch (err) {
            console.error("Failed during analysis or playback setup:", err);
            playAudioAndAnalyze();
            isPlaying = true;
            playButton.textContent = 'Pause';
            playButton.disabled = false;
        }
    });

    // --- Parallel Audio Analysis Setup ---
    function playAudioAndAnalyze() {
        sourceNode = audioContext.createBufferSource();
        sourceNode.buffer = audioBuffer;
        const bassFilter = audioContext.createBiquadFilter();
        bassFilter.type = 'lowpass';
        bassFilter.frequency.value = 180;
        sourceNode.connect(bassFilter);
        bassMeyda = Meyda.createMeydaAnalyzer({ audioContext, source: bassFilter, bufferSize: 1024, featureExtractors: ["loudness"], callback: handleBassFeatures });
        bassMeyda.start();
        const midsFilter = audioContext.createBiquadFilter();
        midsFilter.type = 'bandpass';
        midsFilter.frequency.value = 1500;
        midsFilter.Q.value = 1;
        sourceNode.connect(midsFilter);
        midsMeyda = Meyda.createMeydaAnalyzer({ audioContext, source: midsFilter, bufferSize: 1024, featureExtractors: ["loudness"], callback: handleMidsFeatures });
        midsMeyda.start();
        overallMeyda = Meyda.createMeydaAnalyzer({
            audioContext, source: sourceNode, bufferSize: 1024, featureExtractors: ["loudness"],
            callback: features => {
                smoothedLoudness = smoothedLoudness + (features.loudness.total - smoothedLoudness) * SMOOTHING_FACTOR;
            }
        });
        overallMeyda.start();
        sourceNode.connect(audioContext.destination);
        sourceNode.start(0);
        lastBeatTimestamp = Date.now(); // *** MODIFIED: Reset timer on play ***
        startVisualization();
        sourceNode.onended = () => {
            if (bassMeyda) bassMeyda.stop();
            if (midsMeyda) midsMeyda.stop();
            if (overallMeyda) overallMeyda.stop();
            isPlaying = false;
            playButton.textContent = 'Play';
            if (audioContext && audioContext.state !== 'closed') audioContext.suspend();
            stopVisualization();
        };
    }

    // --- Feature Handlers ---
    function handleBassFeatures(features) {
        const mode = filterSelect.value;
        if (mode === 'mids') return;
        const beatIntensity = bassDetector.isBeat(features.loudness.total, dynamicCooldown * settings.cooldownMultiplier);
        if (beatIntensity > 0) {
            createBeatCircle(beatIntensity);
            triggerBackgroundPulse(beatIntensity);
        }
    }
    function handleMidsFeatures(features) {
        const mode = filterSelect.value;
        if (mode === 'bass') return;
        const beatIntensity = midsDetector.isBeat(features.loudness.total, dynamicCooldown * settings.cooldownMultiplier * 0.5);
        if (beatIntensity > 0) {
            spawnRandomTriangles(beatIntensity);
            triggerBackgroundPulse(beatIntensity);
        }
    }
    
    // --- Background Canvas and Drawing Logic ---
    function setupCanvas() {
        backgroundCanvas.width = window.innerWidth;
        backgroundCanvas.height = window.innerHeight;
    }
    function startVisualization() {
        if (!animationFrameId) drawBackground();
    }
    function stopVisualization() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
            // Clear the canvas completely for a clean stop
            ctx.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
        }
    }

    // *** MODIFIED: This function now handles restarting the animation loop ***
    function triggerBackgroundPulse(intensity) {
        lastBeatTimestamp = Date.now(); // Update the timestamp on every beat
        backgroundPulse = Math.min(1.0, backgroundPulse + intensity * 0.15);
        startVisualization(); // Ensure the animation loop is running
    }

    function drawBackground() {
        // --- MODIFIED DRAWING LOGIC WITH FADE-OUT ---
        const timeSinceLastBeat = Date.now() - lastBeatTimestamp;
        let fadeMultiplier = 1.0;

        // 1. Calculate fade multiplier if inactive
        if (timeSinceLastBeat > FADE_START_TIME) {
            const fadeProgress = Math.min(1.0, (timeSinceLastBeat - FADE_START_TIME) / FADE_DURATION);
            fadeMultiplier = 1.0 - fadeProgress;
        }

        // 2. If completely faded, stop the animation loop to save resources
        if (fadeMultiplier <= 0) {
            stopVisualization();
            return; // Exit the function early
        }

        // 3. Decay the pulse and calculate visual properties
        backgroundPulse *= PULSE_DECAY_FACTOR;
        const ambientIntensity = Math.min(smoothedLoudness, 20);
        const ambientBrightness = 5 + ambientIntensity * 1.5;
        const pulseBrightness = backgroundPulse * 35;
        const totalBrightness = ambientBrightness + pulseBrightness;
        const hue = 260 + ambientIntensity * 2 + backgroundPulse * 20;
        const radius = backgroundCanvas.width / 3 + ambientIntensity * 10 + backgroundPulse * 250;

        // 4. Render the frame
        ctx.fillStyle = `rgba(10, 10, 20, 0.1)`;
        ctx.fillRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
        const centerX = backgroundCanvas.width / 2;
        const centerY = backgroundCanvas.height / 2;
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        
        // bg alpha (sigma)
        gradient.addColorStop(0, `hsla(${hue}, 0%, ${totalBrightness}%, ${0.2 * fadeMultiplier})`);
        gradient.addColorStop(1, `hsla(${hue}, 0%, ${totalBrightness}%, 0)`);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
        animationFrameId = requestAnimationFrame(drawBackground);
    }

    // anims
    function createBeatCircle(intensity = 5) {
        const circle = document.createElement('div');
        circle.classList.add('circle');
        visualizationContainer.appendChild(circle);
        const scale = Math.min(settings.maxScale, 2 + intensity * 2);
        anime({ targets: circle, scale: [0, scale], opacity: [1, 0], easing: 'easeOutExpo', duration: settings.animationDuration, complete: () => circle.remove() });
    }
    function spawnRandomTriangles(beatIntensity) {
        // ();
        let triangleCount = (beatIntensity < 3) ? 1 : (beatIntensity < 7) ? Math.floor(Math.random() * 2) + 2 : Math.floor(Math.random() * 2) + 4;
        triangleCount = Math.min(triangleCount, 6);
        for (let i = 0; i < triangleCount; i++) createBeatTriangle(beatIntensity);
    }
    function createBeatTriangle(beatIntensity) {
        const triangle = document.createElement('div');
        triangle.classList.add('triangle');
        visualizationContainer.appendChild(triangle);
        const finalRotation = Math.random() * 360;
        const scaleMultiplier = 1 + Math.min(beatIntensity / 10, 2);
        const finalHorizontalScale = 1 * scaleMultiplier;
        const tl = anime.timeline({ targets: triangle, easing: 'easeOutExpo', complete: () => triangle.remove() });
        tl.add({ translateX: ['-50%', '-50%'], rotate: [finalRotation - 45, finalRotation], scaleX: [finalHorizontalScale, 0], scaleY: [1, 2], opacity: [0.5, 1], duration: 300, easing: 'easeOutSine' })
          .add({ translateX: ['-50%', '-50%'], scaleY: 15, opacity: 0, duration: 500, easing: 'easeOutExpo' }, '-=50');
    }

    // uhh go go script yay
    initializeUI();
});