import { analyze } from 'https://esm.sh/web-audio-beat-detector';
import Meyda from 'https://esm.sh/meyda';


window.addEventListener('DOMContentLoaded', () => {

    
    const audioFileInput = document.getElementById('audio-file');
    const playButton = document.getElementById('play-button');
    const visualizationContainer = document.getElementById('visualization');
    const manualTriggerButton = document.getElementById('manual-trigger-button');
    const filterSelect = document.getElementById('filter-select');
    const sensitivitySlider = document.getElementById('sensitivity-slider');
    const sensitivityValue = document.getElementById('sensitivity-value');
    const cooldownSlider = document.getElementById('cooldown-slider');
    const cooldownValue = document.getElementById('cooldown-value');
    const scaleSlider = document.getElementById('scale-slider');
    const scaleValue = document.getElementById('scale-value');
    const durationSlider = document.getElementById('duration-slider');
    const durationValue = document.getElementById('duration-value');

    
    const settings = {
        sensitivity: 1.4,
        cooldownMultiplier: 1.0,
        maxScale: 10,
        animationDuration: 2000,
    };

    
    let audioContext, audioBuffer, sourceNode, meydaAnalyzer, filterNode;
    let isPlaying = false;
    let detectedBpm = null;
    let dynamicCooldown = 200;
    
    let lastCircleBeatTime = 0;
    let lastTriangleBeatTime = 0;
    const ENERGY_HISTORY_SIZE = 100;
    let energyHistory = [];

    
    function initializeUI() {
        sensitivitySlider.value = settings.sensitivity;
        sensitivityValue.textContent = settings.sensitivity.toFixed(2);
        cooldownSlider.value = settings.cooldownMultiplier;
        cooldownValue.textContent = settings.cooldownMultiplier.toFixed(2) + 'x';
        scaleSlider.value = settings.maxScale;
        scaleValue.textContent = settings.maxScale;
        durationSlider.value = settings.animationDuration;
        durationValue.textContent = settings.animationDuration;
    }
    sensitivitySlider.addEventListener('input', (e) => {
        settings.sensitivity = parseFloat(e.target.value);
        sensitivityValue.textContent = settings.sensitivity.toFixed(2);
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
    filterSelect.addEventListener('change', (e) => {
        if (filterNode) setupFilter(e.target.value);
    });
    manualTriggerButton.addEventListener('click', () => {
        createBeatCircle();
        spawnRandomTriangles();
    });
    audioFileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (audioContext) await audioContext.close();
        visualizationContainer.innerHTML = '';
        isPlaying = false;
        sourceNode = null;
        filterNode = null;
        detectedBpm = null;
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
            return;
        }
        if (isPlaying) {
            await audioContext.suspend();
            isPlaying = false;
            playButton.textContent = 'Play';
            return;
        }
        playButton.disabled = true;
        playButton.textContent = 'Analyzing...';
        try {
            if (!detectedBpm) {
                const tempo = await analyze(audioBuffer);
                detectedBpm = Math.round(tempo);
                const quarterNoteDuration = (60 / detectedBpm) * 1000;
                dynamicCooldown = quarterNoteDuration / 2;
            }
            playAudioAndAnalyze();
            isPlaying = true;
            playButton.textContent = 'Pause';
            playButton.disabled = false;
        } catch (err) {
            console.error("Failed during analysis or playback setup:", err);
            playButton.textContent = 'Play';
            playButton.disabled = false;
        }
    });

    
    function setupFilter(mode) {
        if (!filterNode) return;
        filterNode.gain.value = 0;
        switch (mode) {
            case 'bass':
                filterNode.type = 'lowpass';
                filterNode.frequency.value = 150;
                break;
            case 'mids':
                filterNode.type = 'bandpass';
                filterNode.frequency.value = 1500;
                filterNode.Q.value = 2;
                break;
            case 'full':
            default:
                filterNode.type = 'lowpass';
                filterNode.frequency.value = 20000;
                break;
        }
    }

    function playAudioAndAnalyze() {
        sourceNode = audioContext.createBufferSource();
        sourceNode.buffer = audioBuffer;
        filterNode = audioContext.createBiquadFilter();
        sourceNode.connect(filterNode);
        sourceNode.connect(audioContext.destination);
        setupFilter(filterSelect.value);

        meydaAnalyzer = Meyda.createMeydaAnalyzer({
            audioContext: audioContext,
            source: filterNode,
            bufferSize: 1024,
            featureExtractors: ["energy"],
            callback: (features) => {
                
                if (isCircleBeat(features.energy)) {
                    createBeatCircle();
                }
                if (isTriangleBeat(features.energy)) {
                    spawnRandomTriangles();
                }
            },
        });

        meydaAnalyzer.start();
        sourceNode.start(0);
        sourceNode.onended = () => {
            if (meydaAnalyzer) meydaAnalyzer.stop();
            isPlaying = false;
            playButton.textContent = 'Play';
            audioContext.suspend();
        };
    }

    
    function isCircleBeat(currentEnergy) {
        const now = Date.now();
        
        if (now - lastCircleBeatTime < (dynamicCooldown * settings.cooldownMultiplier * 2)) {
            return false;
        }

        if (energyHistory.length < ENERGY_HISTORY_SIZE) {
            return false; 
        }

        const averageEnergy = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;
        const threshold = averageEnergy * settings.sensitivity;
        const isBeat = currentEnergy > threshold;

        if (isBeat) {
            lastCircleBeatTime = now;
            return true;
        }
        return false;
    }

    function isTriangleBeat(currentEnergy) {
        const now = Date.now();
        
        if (now - lastTriangleBeatTime < (dynamicCooldown * settings.cooldownMultiplier)) {
            return false;
        }

        if (energyHistory.length < ENERGY_HISTORY_SIZE) {
            energyHistory.push(currentEnergy); 
            return false;
        }

        const averageEnergy = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;
        const threshold = averageEnergy * settings.sensitivity;
        const isBeat = currentEnergy > threshold;

        
        energyHistory.shift();
        energyHistory.push(currentEnergy);

        if (isBeat) {
            lastTriangleBeatTime = now;
            return true;
        }
        return false;
    }

    
    function createBeatCircle() {
        const circle = document.createElement('div');
        circle.classList.add('circle');
        visualizationContainer.appendChild(circle);
        anime({
            targets: circle,
            scale: [0, settings.maxScale],
            opacity: [1, 0],
            easing: 'easeOutExpo',
            duration: settings.animationDuration,
            complete: () => {
                if (visualizationContainer.contains(circle)) {
                    visualizationContainer.removeChild(circle);
                }
            }
        });
    }

    function spawnRandomTriangles() {
        const triangleCount = Math.floor(Math.random() * 5) + 1;
        for (let i = 0; i < triangleCount; i++) {
            createBeatTriangle();
        }
    }

    function createBeatTriangle(rotation) {
        const triangle = document.createElement('div');
        triangle.classList.add('triangle');
        visualizationContainer.appendChild(triangle);

        const finalRotation = (rotation === undefined) ? Math.random() * 360 : rotation;

        const tl = anime.timeline({
            targets: triangle,
            easing: 'easeOutExpo',
            complete: () => {
                if (visualizationContainer.contains(triangle)) {
                    visualizationContainer.removeChild(triangle);
                }
            }
        });

        tl.add({
            translateX: ['-50%', '-50%'],
            rotate: [finalRotation - 45, finalRotation],
            scaleX: [2.5, 0.05],
            scaleY: [0, 1],
            opacity: [0.5, 1],
            duration: 150,
            easing: 'easeOutSine'
        }).add({
            translateX: ['-50%', '-50%'],
            scaleY: 15,
            opacity: 0,
            duration: settings.animationDuration,
            easing: 'easeOutExpo'
        }, '-=50');
    }

    
    initializeUI();
});