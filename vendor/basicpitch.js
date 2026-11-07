/* Basic Pitch TS 1.0.1 (Apache-2.0, Spotify AB) - ESM->classic script; MIDI file export removed. */
window.BasicPitchLib={};
(function(){
const tf=window.tf;
const OUTPUT_TO_TENSOR_NAME = {
    contours: 'Identity',
    onsets: 'Identity_2',
    frames: 'Identity_1',
};
const NUM_CHANNELS = 1;
const AUDIO_SAMPLE_RATE = 22050;
const FFT_HOP = 256;
const ANNOTATIONS_FPS = Math.floor(AUDIO_SAMPLE_RATE / FFT_HOP);
const AUDIO_WINDOW_LENGTH_SECONDS = 2;
const AUDIO_N_SAMPLES = AUDIO_SAMPLE_RATE * AUDIO_WINDOW_LENGTH_SECONDS - FFT_HOP;
const N_OVERLAPPING_FRAMES = 30;
const N_OVERLAP_OVER_2 = Math.floor(N_OVERLAPPING_FRAMES / 2);
const OVERLAP_LENGTH_FRAMES = N_OVERLAPPING_FRAMES * FFT_HOP;
const HOP_SIZE = AUDIO_N_SAMPLES - OVERLAP_LENGTH_FRAMES;
class BasicPitch {
    constructor(modelOrModelPath) {
        if (OVERLAP_LENGTH_FRAMES % 2 !== 0) {
            throw new Error(`OVERLAP_LENGTH_FRAMES is not divisible by 2! Is ${OVERLAP_LENGTH_FRAMES}`);
        }
        this.model =
            typeof modelOrModelPath === 'string'
                ? tf.loadGraphModel(modelOrModelPath)
                : modelOrModelPath;
    }
    adjustNoteStart(notes, offsetSeconds) {
        return notes.map((note) => ({
            startTimeSeconds: note.startTimeSeconds + offsetSeconds,
            durationSeconds: note.durationSeconds,
            pitch_midi: note.pitchMidi,
            amplitude: note.amplitude,
            pitchBends: note.pitchBends,
        }));
    }
    /* 메모리: 모든 중간 텐서는 즉시 해제하고(tidy/dispose), 출력은 중첩 JS 배열 대신 Float32Array 조각 위의 행 뷰로 넘긴다(값은 float32 그대로라 결과 동일). */
    async evaluateSingleFrame(reshapedInput, batchNumber) {
        const model = await this.model;
        return tf.tidy(() => {
            const singleBatch = tf.slice(reshapedInput, batchNumber, 1);
            const results = model.execute(singleBatch, [
                OUTPUT_TO_TENSOR_NAME.frames,
                OUTPUT_TO_TENSOR_NAME.onsets,
                OUTPUT_TO_TENSOR_NAME.contours,
            ]);
            return [results[0], results[1], results[2]];
        });
    }
    async prepareData(singleChannelAudioData) {
        return tf.tidy(() => {
            const wavSamples = tf.concat1d([
                tf.zeros([Math.floor(OVERLAP_LENGTH_FRAMES / 2)], 'float32'),
                tf.tensor(singleChannelAudioData),
            ]);
            return [
                tf.expandDims(tf.signal.frame(wavSamples, AUDIO_N_SAMPLES, HOP_SIZE, true, 0), -1),
                singleChannelAudioData.length,
            ];
        });
    }
    unwrapOutput(result, framesToOutput) {
        return tf.tidy(() => {
            let rawOutput = result.slice([0, N_OVERLAP_OVER_2, 0], [-1, result.shape[1] - 2 * N_OVERLAP_OVER_2, -1]);
            const outputShape = rawOutput.shape;
            let flat = rawOutput.reshape([outputShape[0] * outputShape[1], outputShape[2]]);
            if (framesToOutput != null && framesToOutput < flat.shape[0]) {
                flat = flat.slice([0, 0], [framesToOutput, -1]);
            }
            return flat;
        });
    }
    /* 텐서 [N, W] -> Float32Array 조각을 N 개의 행 뷰로 */
    tensorToRows(t) {
        const w = t.shape[1], n = t.shape[0], buf = t.dataSync().slice(), rows = new Array(n);
        for (let r = 0; r < n; r++) rows[r] = buf.subarray(r * w, (r + 1) * w);
        return rows;
    }
    async evaluateModel(resampledBuffer, onComplete, percentCallback) {
        let singleChannelAudioData;
        if (resampledBuffer instanceof Float32Array) {
            singleChannelAudioData = resampledBuffer;
        }
        else {
            if (resampledBuffer.sampleRate !== AUDIO_SAMPLE_RATE) {
                throw new Error(`Input audio buffer is not at correct sample rate! ` +
                    `Is ${resampledBuffer.sampleRate}. Should be ${AUDIO_SAMPLE_RATE}`);
            }
            if (resampledBuffer.numberOfChannels !== NUM_CHANNELS) {
                throw new Error(`Input audio buffer is not mono! ` +
                    `Number of channels is ${resampledBuffer.numberOfChannels}. Should be ${NUM_CHANNELS}`);
            }
            singleChannelAudioData = resampledBuffer.getChannelData(0);
        }
        const [reshapedInput, audioOriginalLength] = await this.prepareData(singleChannelAudioData);
        try {
            const nOutputFramesOriginal = Math.floor(audioOriginalLength * (ANNOTATIONS_FPS / AUDIO_SAMPLE_RATE));
            let calculatedFrames = 0;
            for (let i = 0; i < reshapedInput.shape[0]; ++i) {
                percentCallback(i / reshapedInput.shape[0]);
                const outs = await this.evaluateSingleFrame(reshapedInput, i);
                try {
                    const calculatedFramesTmp = outs[0].shape[1] - 2 * N_OVERLAP_OVER_2;
                    if (calculatedFrames >= nOutputFramesOriginal) {
                        continue;
                    }
                    const framesToOutput = calculatedFramesTmp + calculatedFrames >= nOutputFramesOriginal
                        ? nOutputFramesOriginal - calculatedFrames : null;
                    const un = outs.map(o => this.unwrapOutput(o, framesToOutput));
                    try {
                        calculatedFrames += calculatedFramesTmp;
                        onComplete(this.tensorToRows(un[0]), this.tensorToRows(un[1]), this.tensorToRows(un[2]));
                    } finally { un.forEach(t => t.dispose()); }
                } finally { outs.forEach(t => t.dispose()); }
            }
            percentCallback(1.0);
        } finally { reshapedInput.dispose(); }
    }
}

window.BasicPitchLib.BasicPitch=BasicPitch;
})();
(function(){

const MIDI_OFFSET = 21;
const AUDIO_SAMPLE_RATE = 22050;
const AUDIO_WINDOW_LENGTH = 2;
const FFT_HOP = 256;
const ANNOTATIONS_FPS = Math.floor(AUDIO_SAMPLE_RATE / FFT_HOP);
const ANNOT_N_FRAMES = ANNOTATIONS_FPS * AUDIO_WINDOW_LENGTH;
const AUDIO_N_SAMPLES = AUDIO_SAMPLE_RATE * AUDIO_WINDOW_LENGTH - FFT_HOP;
const WINDOW_OFFSET = (FFT_HOP / AUDIO_SAMPLE_RATE) * (ANNOT_N_FRAMES - AUDIO_N_SAMPLES / FFT_HOP) +
    0.0018;
const MAX_FREQ_IDX = 87;
const CONTOURS_BINS_PER_SEMITONE = 3;
const ANNOTATIONS_BASE_FREQUENCY = 27.5;
const ANNOTATIONS_N_SEMITONES = 88;
const N_FREQ_BINS_CONTOURS = ANNOTATIONS_N_SEMITONES * CONTOURS_BINS_PER_SEMITONE;
const hzToMidi = (hz) => 12 * (Math.log2(hz) - Math.log2(440.0)) + 69;
const midiToHz = (midi) => 440.0 * 2.0 ** ((midi - 69.0) / 12.0);
const modelFrameToTime = (frame) => (frame * FFT_HOP) / AUDIO_SAMPLE_RATE -
    WINDOW_OFFSET * Math.floor(frame / ANNOT_N_FRAMES);
function argMax(arr) {
    return arr.length === 0
        ? null
        : arr.reduce((maxIndex, currentValue, index) => arr[maxIndex] > currentValue ? maxIndex : index, -1);
}
const argMaxAxis1 = (arr) => arr.map(row => argMax(row));
function whereGreaterThanAxis1(arr2d, threshold) {
    const outputX = [];
    const outputY = [];
    for (let i = 0; i < arr2d.length; i++) {
        for (let j = 0; j < arr2d[i].length; j++) {
            if (arr2d[i][j] > threshold) {
                outputX.push(i);
                outputY.push(j);
            }
        }
    }
    return [outputX, outputY];
}
function meanStdDev(array) {
    const [sum, sumSquared, count] = array.reduce((prev, row) => {
        const [rowSum, rowSumsSquared, rowCount] = row.reduce((p, value) => [p[0] + value, p[1] + value * value, p[2] + 1], [0, 0, 0]);
        return [prev[0] + rowSum, prev[1] + rowSumsSquared, prev[2] + rowCount];
    }, [0, 0, 0]);
    const mean = sum / count;
    const std = Math.sqrt((1 / (count - 1)) * (sumSquared - (sum * sum) / count));
    return [mean, std];
}
function globalMax(array) {
    return array.reduce((prev, row) => Math.max(prev, ...row), 0);
}
function min3dForAxis0(array) {
    const minArray = array[0].map(v => Array.from(v));
    for (let x = 1; x < array.length; ++x) {
        for (let y = 0; y < array[0].length; ++y) {
            for (let z = 0; z < array[0][0].length; ++z) {
                minArray[y][z] = Math.min(minArray[y][z], array[x][y][z]);
            }
        }
    }
    return minArray;
}
function argRelMax(array, order = 1) {
    const result = [];
    for (let col = 0; col < array[0].length; ++col) {
        for (let row = 0; row < array.length; ++row) {
            let isRelMax = true;
            for (let comparisonRow = Math.max(0, row - order); isRelMax && comparisonRow <= Math.min(array.length - 1, row + order); ++comparisonRow) {
                if (comparisonRow !== row) {
                    isRelMax = isRelMax && array[row][col] > array[comparisonRow][col];
                }
            }
            if (isRelMax) {
                result.push([row, col]);
            }
        }
    }
    return result;
}
function max3dForAxis0(array) {
    const maxArray = array[0].map(v => Array.from(v));
    for (let x = 1; x < array.length; ++x) {
        for (let y = 0; y < array[0].length; ++y) {
            for (let z = 0; z < array[0][0].length; ++z) {
                maxArray[y][z] = Math.max(maxArray[y][z], array[x][y][z]);
            }
        }
    }
    return maxArray;
}
function isNotNull(t) {
    return t !== null;
}
function constrainFrequency(onsets, frames, maxFreq, minFreq) {
    if (maxFreq) {
        const maxFreqIdx = hzToMidi(maxFreq) - MIDI_OFFSET;
        for (let i = 0; i < onsets.length; i++) {
            onsets[i].fill(0, maxFreqIdx);
        }
        for (let i = 0; i < frames.length; i++) {
            frames[i].fill(0, maxFreqIdx);
        }
    }
    if (minFreq) {
        const minFreqIdx = hzToMidi(minFreq) - MIDI_OFFSET;
        for (let i = 0; i < onsets.length; i++) {
            onsets[i].fill(0, 0, minFreqIdx);
        }
        for (let i = 0; i < frames.length; i++) {
            frames[i].fill(0, 0, minFreqIdx);
        }
    }
}
/* 메모리: 원본은 프레임 차분·최소·최대마다 전체 크기 행렬을 새로 만들었다(15000x88 이중 배열 열 개 남짓). 같은 식을 한 칸씩 계산해 결과 행렬 하나만 만든다(값 동일: 같은 배정밀도 연산). */
function getInferredOnsets(onsets, frames, nDiff = 2) {
    const nR = frames.length, nC = frames[0].length;
    const diffMin = (r, c) => {
        let m = Infinity;
        for (let n = 1; n <= nDiff; n++) {
            const prev = r - n >= 0 ? frames[r - n][c] : 0;
            const d = frames[r][c] - prev;
            if (d < m) m = d;
        }
        return Math.max(m, 0);
    };
    const fd = (r, c) => (r < nDiff ? 0 : diffMin(r, c));
    const onsetMax = globalMax(onsets);
    let frameDiffMax = 0;
    for (let r = 0; r < nR; r++) for (let c = 0; c < nC; c++) frameDiffMax = Math.max(frameDiffMax, fd(r, c));
    const out = new Array(nR);
    for (let r = 0; r < nR; r++) {
        const row = new Array(nC);
        for (let c = 0; c < nC; c++) row[c] = Math.max(onsets[r][c], (onsetMax * fd(r, c)) / frameDiffMax);
        out[r] = row;
    }
    return out;
}
function outputToNotesPoly(frames, onsets, onsetThresh = 0.5, frameThresh = 0.3, minNoteLen = 5, inferOnsets = true, maxFreq = null, minFreq = null, melodiaTrick = true, energyTolerance = 11) {
    let inferredFrameThresh = frameThresh;
    if (inferredFrameThresh === null) {
        const [mean, std] = meanStdDev(frames);
        inferredFrameThresh = mean + std;
    }
    const nFrames = frames.length;
    constrainFrequency(onsets, frames, maxFreq, minFreq);
    let inferredOnsets = onsets;
    if (inferOnsets) {
        inferredOnsets = getInferredOnsets(onsets, frames);
    }
    const peakThresholdMatrix = inferredOnsets.map(o => Array.from(o, () => 0));
    argRelMax(inferredOnsets).forEach(([row, col]) => {
        peakThresholdMatrix[row][col] = inferredOnsets[row][col];
    });
    const [noteStarts, freqIdxs] = whereGreaterThanAxis1(peakThresholdMatrix, onsetThresh);
    noteStarts.reverse();
    freqIdxs.reverse();
    const remainingEnergy = frames.map(frame => Array.from(frame));
    const noteEvents = noteStarts
        .map((noteStartIdx, idx) => {
        const freqIdx = freqIdxs[idx];
        if (noteStartIdx >= nFrames - 1) {
            return null;
        }
        let i = noteStartIdx + 1;
        let k = 0;
        while (i < nFrames - 1 && k < energyTolerance) {
            if (remainingEnergy[i][freqIdx] < inferredFrameThresh) {
                k += 1;
            }
            else {
                k = 0;
            }
            i += 1;
        }
        i -= k;
        if (i - noteStartIdx <= minNoteLen) {
            return null;
        }
        for (let j = noteStartIdx; j < i; ++j) {
            remainingEnergy[j][freqIdx] = 0;
            if (freqIdx < MAX_FREQ_IDX) {
                remainingEnergy[j][freqIdx + 1] = 0;
            }
            if (freqIdx > 0) {
                remainingEnergy[j][freqIdx - 1] = 0;
            }
        }
        const amplitude = frames
            .slice(noteStartIdx, i)
            .reduce((prev, row) => prev + row[freqIdx], 0) /
            (i - noteStartIdx);
        return {
            startFrame: noteStartIdx,
            durationFrames: i - noteStartIdx,
            pitchMidi: freqIdx + MIDI_OFFSET,
            amplitude: amplitude,
        };
    })
        .filter(isNotNull);
    if (melodiaTrick === true) {
        while (globalMax(remainingEnergy) > inferredFrameThresh) {
            const [iMid, freqIdx] = remainingEnergy.reduce((prevCoord, currRow, rowIdx) => {
                const colMaxIdx = argMax(currRow);
                return currRow[colMaxIdx] >
                    remainingEnergy[prevCoord[0]][prevCoord[1]]
                    ? [rowIdx, colMaxIdx]
                    : prevCoord;
            }, [0, 0]);
            remainingEnergy[iMid][freqIdx] = 0;
            let i = iMid + 1;
            let k = 0;
            while (i < nFrames - 1 && k < energyTolerance) {
                if (remainingEnergy[i][freqIdx] < inferredFrameThresh) {
                    k += 1;
                }
                else {
                    k = 0;
                }
                remainingEnergy[i][freqIdx] = 0;
                if (freqIdx < MAX_FREQ_IDX) {
                    remainingEnergy[i][freqIdx + 1] = 0;
                }
                if (freqIdx > 0) {
                    remainingEnergy[i][freqIdx - 1] = 0;
                }
                i += 1;
            }
            const iEnd = i - 1 - k;
            i = iMid - 1;
            k = 0;
            while (i > 0 && k < energyTolerance) {
                if (remainingEnergy[i][freqIdx] < inferredFrameThresh) {
                    k += 1;
                }
                else {
                    k = 0;
                }
                remainingEnergy[i][freqIdx] = 0;
                if (freqIdx < MAX_FREQ_IDX) {
                    remainingEnergy[i][freqIdx + 1] = 0;
                }
                if (freqIdx > 0) {
                    remainingEnergy[i][freqIdx - 1] = 0;
                }
                i -= 1;
            }
            const iStart = i + 1 + k;
            if (iStart < 0) {
                throw new Error(`iStart is not positive! value: ${iStart}`);
            }
            if (iEnd >= nFrames) {
                throw new Error(`iEnd is past end of times. (iEnd, times.length): (${iEnd}, ${nFrames})`);
            }
            const amplitude = frames.slice(iStart, iEnd).reduce((sum, row) => sum + row[freqIdx], 0) /
                (iEnd - iStart);
            if (iEnd - iStart <= minNoteLen) {
                continue;
            }
            noteEvents.push({
                startFrame: iStart,
                durationFrames: iEnd - iStart,
                pitchMidi: freqIdx + MIDI_OFFSET,
                amplitude: amplitude,
            });
        }
    }
    return noteEvents;
}
const gaussian = (M, std) => Array.from(Array(M).keys()).map(n => Math.exp((-1 * (n - (M - 1) / 2) ** 2) / (2 * std ** 2)));
const midiPitchToContourBin = (pitchMidi) => 12.0 *
    CONTOURS_BINS_PER_SEMITONE *
    Math.log2(midiToHz(pitchMidi) / ANNOTATIONS_BASE_FREQUENCY);
function addPitchBendsToNoteEvents(contours, notes, nBinsTolerance = 25) {
    const windowLength = nBinsTolerance * 2 + 1;
    const freqGaussian = gaussian(windowLength, 5);
    return notes.map(note => {
        const freqIdx = Math.floor(Math.round(midiPitchToContourBin(note.pitchMidi)));
        const freqStartIdx = Math.max(freqIdx - nBinsTolerance, 0);
        const freqEndIdx = Math.min(N_FREQ_BINS_CONTOURS, freqIdx + nBinsTolerance + 1);
        const freqGuassianSubMatrix = freqGaussian.slice(Math.max(0, nBinsTolerance - freqIdx), windowLength -
            Math.max(0, freqIdx - (N_FREQ_BINS_CONTOURS - nBinsTolerance - 1)));
        const pitchBendSubmatrix = contours
            .slice(note.startFrame, note.startFrame + note.durationFrames)
            .map(d => Array.from(d.subarray ? d.subarray(freqStartIdx, freqEndIdx) : d.slice(freqStartIdx, freqEndIdx), (v, col) => v * freqGuassianSubMatrix[col]));
        const pbShift = nBinsTolerance - Math.max(0, nBinsTolerance - freqIdx);
        const bends = argMaxAxis1(pitchBendSubmatrix).map(v => v - pbShift);
        return Object.assign(Object.assign({}, note), { pitchBends: bends });
    });
}
const noteFramesToTime = (notes) => notes.map(note => {
    return {
        pitchMidi: note.pitchMidi,
        amplitude: note.amplitude,
        pitchBends: note.pitchBends,
        startTimeSeconds: modelFrameToTime(note.startFrame),
        durationSeconds: modelFrameToTime(note.startFrame + note.durationFrames) -
            modelFrameToTime(note.startFrame),
    };
});

Object.assign(window.BasicPitchLib,{outputToNotesPoly,addPitchBendsToNoteEvents,noteFramesToTime});
})();
