import WaveSurfer from "https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js";
import Regions from "https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.esm.js";

class ApiClient {
  constructor() {
    this.baseUrl = "";
  }

  async createProject(file) {
    const form = new FormData();
    form.append("file", file);

    const res = await fetch(`${this.baseUrl}/api/projects`, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  }

  getAudioUrl(projectId) {
    return `${this.baseUrl}/api/projects/${projectId}/audio`;
  }

  async export(projectId, payload) {
    const res = await fetch(`${this.baseUrl}/api/projects/${projectId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  }
}

class TimeUtils {
  static toClock(seconds) {
    const totalCentis = Math.max(0, Math.round(seconds * 100));
    const mm = String(Math.floor(totalCentis / 6000)).padStart(2, "0");
    const ss = String(Math.floor((totalCentis % 6000) / 100)).padStart(2, "0");
    const cs = String(totalCentis % 100).padStart(2, "0");
    return `${mm}:${ss}.${cs}`;
  }
}

class SelectionState {
  constructor() {
    this.startS = null;
    this.endS = null;
  }

  isComplete() {
    return Number.isFinite(this.startS) && Number.isFinite(this.endS);
  }

  reset() {
    this.startS = null;
    this.endS = null;
  }

  setStart(timeS) {
    this.startS = timeS;
    this._normalize();
  }

  setEnd(timeS) {
    this.endS = timeS;
    this._normalize();
  }

  clearEnd() {
    this.endS = null;
  }

  _normalize() {
    if (!this.isComplete()) return;
    if (this.endS < this.startS) {
      const tmp = this.startS;
      this.startS = this.endS;
      this.endS = tmp;
    }
  }
}

class CutterApp {
  constructor() {
    this.api = new ApiClient();
    this.projectId = null;

    this.wave = null;
    this.regions = null;
    this.selectionRegion = null;
    this.isSyncingRegion = false;
    this.selection = new SelectionState();
    this.cuts = [];

    this.fileInput = document.getElementById("fileInput");
    this.uploadBtn = document.getElementById("uploadBtn");
    this.projectInfo = document.getElementById("projectInfo");

    this.playBtn = document.getElementById("playBtn");
    this.zoomOutBtn = document.getElementById("zoomOutBtn");
    this.zoomInBtn = document.getElementById("zoomInBtn");
    this.zoomResetBtn = document.getElementById("zoomResetBtn");
    this.markNowBtn = document.getElementById("markNowBtn");
    this.resetSelectionBtn = document.getElementById("resetSelectionBtn");
    this.undoCutBtn = document.getElementById("undoCutBtn");
    this.addCutBtn = document.getElementById("addCutBtn");

    this.selectionInfo = document.getElementById("selectionInfo");
    this.timeInfo = document.getElementById("timeInfo");

    this.segmentsDiv = document.getElementById("segments");
    this.exportBtn = document.getElementById("exportBtn");
    this.exportLog = document.getElementById("exportLog");
    this.bitrate = document.getElementById("bitrate");

    this.zoomPxPerSec = null;
    this.zoomStep = 1.25;
    this.zoomMaxPxPerSec = 1200;

    this._bind();
    this._setUiDisabled(true);
    this._refreshSelectionUi();
  }

  _bind() {
    this.uploadBtn.addEventListener("click", () => this._onUpload());
    this.playBtn.addEventListener("click", () => this._togglePlay());
    this.zoomOutBtn.addEventListener("click", () => this._zoomOut());
    this.zoomInBtn.addEventListener("click", () => this._zoomIn());
    this.zoomResetBtn.addEventListener("click", () => this._resetZoom());
    this.markNowBtn.addEventListener("click", () => this._markNow());
    this.resetSelectionBtn.addEventListener("click", () => this._resetSelection());
    this.undoCutBtn.addEventListener("click", () => this._undoLastCut());
    this.addCutBtn.addEventListener("click", () => this._addCut());
    this.exportBtn.addEventListener("click", () => this._export());
  }

  _setUiDisabled(disabled) {
    this.playBtn.disabled = disabled;
    this.zoomOutBtn.disabled = disabled;
    this.zoomInBtn.disabled = disabled;
    this.zoomResetBtn.disabled = disabled;
    this.markNowBtn.disabled = disabled;
    this.resetSelectionBtn.disabled = true;
    this.undoCutBtn.disabled = true;
    this.addCutBtn.disabled = true;
    this.exportBtn.disabled = disabled;
  }

  async _onUpload() {
    const file = this.fileInput.files?.[0];
    if (!file) return;

    this._log("Uploading...");
    const data = await this.api.createProject(file);

    this.projectId = data.project_id;
    this.projectInfo.textContent = `Project: ${this.projectId}`;
    await this._loadAudio();
  }

  async _loadAudio() {
    this._setUiDisabled(true);

    this.selection.reset();
    this.cuts = [];
    this._renderCuts();

    this._refreshSelectionUi();

    if (this.wave) {
      this.wave.destroy();
    }
    this.regions = null;
    this.selectionRegion = null;

    const url = this.api.getAudioUrl(this.projectId);
    this.regions = Regions.create();
    this.wave = WaveSurfer.create({
      container: "#waveform",
      height: 120,
      mediaControls: true,
      url: url,
      plugins: [this.regions],
    });

    this.wave.on("timeupdate", (t) => {
      this.timeInfo.textContent = TimeUtils.toClock(t);
    });

    this.wave.on("interaction", () => {
      this._handleWaveClick();
    });

    this.wave.on("ready", () => {
      this._setUiDisabled(false);
      this._resetZoom();
      this._syncSelectionRegion();
      this._log("Audio loaded. Click waveform to set selection, then Add cut.");
    });

    this.regions.on("region-updated", (region) => {
      if (region !== this.selectionRegion) return;
      this._syncSelectionFromRegion(region);
    });
  }

  _togglePlay() {
    if (!this.wave) return;
    this.wave.playPause();
  }

  _markNow() {
    if (!this.wave) return;
    const t = this.wave.getCurrentTime();
    this._applyMarkAtTime(t);
  }

  _handleWaveClick() {
    if (!this.wave) return;
    const t = this.wave.getCurrentTime();
    this._applyMarkAtTime(t);
  }

  _getFitPxPerSec() {
    if (!this.wave) return 1;
    const duration = this.wave.getDuration();
    const container = document.getElementById("waveform");
    const width = container ? container.clientWidth : 0;
    if (!Number.isFinite(duration) || duration <= 0 || width <= 0) return 1;
    return Math.max(1, width / duration);
  }

  _applyZoom(pxPerSec) {
    if (!this.wave) return;
    const fit = this._getFitPxPerSec();
    const clamped = Math.min(this.zoomMaxPxPerSec, Math.max(fit, pxPerSec));
    this.zoomPxPerSec = clamped;
    this.wave.zoom(clamped);
  }

  _zoomIn() {
    if (!this.wave) return;
    if (!Number.isFinite(this.zoomPxPerSec)) {
      this._resetZoom();
      return;
    }
    this._applyZoom(this.zoomPxPerSec * this.zoomStep);
  }

  _zoomOut() {
    if (!this.wave) return;
    if (!Number.isFinite(this.zoomPxPerSec)) {
      this._resetZoom();
      return;
    }
    this._applyZoom(this.zoomPxPerSec / this.zoomStep);
  }

  _resetZoom() {
    if (!this.wave) return;
    this._applyZoom(this._getFitPxPerSec());
  }


  _applyMarkAtTime(timeS) {
    if (!this.wave) return;

    if (!Number.isFinite(this.selection.startS)) {
      this.selection.setStart(timeS);
      this.selection.clearEnd();
      this._syncSelectionUi();
      return;
    }

    if (!Number.isFinite(this.selection.endS)) {
      this.selection.setEnd(timeS);
      this._syncSelectionUi();
      return;
    }

    const boundary = this._pickBoundaryToMove(timeS);
    if (boundary === "start") {
      this.selection.setStart(timeS);
    } else {
      this.selection.setEnd(timeS);
    }

    this._syncSelectionUi();
  }

  _pickBoundaryToMove(timeS) {
    const start = this.selection.startS;
    const end = this.selection.endS;

    if (timeS <= start) return "start";
    if (timeS >= end) return "end";

    const span = end - start;
    if (span <= 0) return "end";

    const rel = (timeS - start) / span;
    if (rel <= 1 / 3) return "start";
    return "end";
  }

  _selectionDuration() {
    if (!this.selection.isComplete()) return 0;
    return Math.max(0, this.selection.endS - this.selection.startS);
  }

  _syncSelectionUi({ syncRegion = true } = {}) {
    this._refreshSelectionUi();
    if (syncRegion) {
      this._syncSelectionRegion();
    }

    const hasStart = Number.isFinite(this.selection.startS);
    this.resetSelectionBtn.disabled = !hasStart;

    const canAdd = this.selection.isComplete() && this._selectionDuration() >= 0.2;
    this.addCutBtn.disabled = !canAdd;
  }

  _refreshSelectionUi() {
    const start = Number.isFinite(this.selection.startS)
      ? TimeUtils.toClock(this.selection.startS)
      : "--:--.--";
    const end = Number.isFinite(this.selection.endS)
      ? TimeUtils.toClock(this.selection.endS)
      : "--:--.--";

    this.selectionInfo.textContent = `Selection: ${start} → ${end}`;
  }

  _syncSelectionRegion() {
    if (!this.wave || !this.regions) return;

    if (!Number.isFinite(this.selection.startS)) {
      if (this.selectionRegion) {
        this.isSyncingRegion = true;
        this.selectionRegion.remove();
        this.selectionRegion = null;
        this.isSyncingRegion = false;
      }
      return;
    }

    const duration = this.wave.getDuration();
    const start = Math.max(0, this.selection.startS);
    const epsilon = 0.01;
    let end = Number.isFinite(this.selection.endS)
      ? this.selection.endS
      : start + epsilon;
    if (Number.isFinite(duration)) {
      end = Math.min(duration, end);
    }
    if (end <= start) {
      end = start + epsilon;
    }

    this.isSyncingRegion = true;
    if (!this.selectionRegion) {
      this.selectionRegion = this.regions.addRegion({
        start,
        end,
        color: "rgba(56, 189, 248, 0.2)",
        drag: true,
        resize: true,
      });
    } else {
      if (typeof this.selectionRegion.setOptions === "function") {
        this.selectionRegion.setOptions({ start, end });
      } else if (typeof this.selectionRegion.update === "function") {
        this.selectionRegion.update({ start, end });
      } else {
        this.selectionRegion.remove();
        this.selectionRegion = this.regions.addRegion({
          start,
          end,
          color: "rgba(56, 189, 248, 0.2)",
          drag: true,
          resize: true,
        });
      }
    }
    this.isSyncingRegion = false;
  }

  _syncSelectionFromRegion(region) {
    if (this.isSyncingRegion || !region) return;
    this.selection.setStart(region.start);
    this.selection.setEnd(region.end);
    this._syncSelectionUi({ syncRegion: false });
  }

  _resetSelection() {
    if (!this.wave) return;

    this.selection.reset();
    this.addCutBtn.disabled = true;
    this.resetSelectionBtn.disabled = true;

    this._refreshSelectionUi();
    this._syncSelectionRegion();
  }

  _addCut() {
    if (!this.selection.isComplete()) return;
    if (this._selectionDuration() < 0.2) return;

    const index = this.cuts.length + 1;
    const filename = `cut_${String(index).padStart(2, "0")}.mp3`;

    const startS = this.selection.startS;
    const endS = this.selection.endS;

    this.cuts.push({
      start_s: startS,
      end_s: endS,
      filename: filename,
    });

    this.selection.setStart(endS);
    this.selection.clearEnd();

    const duration = this.wave ? this.wave.getDuration() : 0;
    this._refreshSelectionUi();
    this._syncSelectionRegion();

    this.addCutBtn.disabled = true;
    this.resetSelectionBtn.disabled = false;
    this.undoCutBtn.disabled = this.cuts.length === 0;

    this._renderCuts();
  }

  _undoLastCut() {
    if (this.cuts.length === 0) return;
    this.cuts.pop();
    this._renderCuts();
    this.undoCutBtn.disabled = this.cuts.length === 0;
  }

  _deleteCut(index) {
    if (index < 0 || index >= this.cuts.length) return;
    this.cuts.splice(index, 1);
    this._renderCuts();
    this.undoCutBtn.disabled = this.cuts.length === 0;
  }

  _renderCuts() {
    this.segmentsDiv.innerHTML = "";

    this.cuts.forEach((cut, idx) => {
      const div = document.createElement("div");
      div.className = "segment";

      const label = document.createElement("div");
      label.textContent = `${TimeUtils.toClock(cut.start_s)} → ${TimeUtils.toClock(cut.end_s)}`;

      const input = document.createElement("input");
      input.type = "text";
      input.value = cut.filename;
      input.addEventListener("input", (e) => {
        this.cuts[idx].filename = e.target.value;
      });

      const actions = document.createElement("div");
      actions.className = "row";

      const jumpBtn = document.createElement("button");
      jumpBtn.textContent = "Jump";
      jumpBtn.addEventListener("click", () => {
        if (!this.wave) return;
        this.wave.setTime(cut.end_s);
      });

      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.className = "danger";
      delBtn.addEventListener("click", () => this._deleteCut(idx));

      actions.appendChild(jumpBtn);
      actions.appendChild(delBtn);

      div.appendChild(label);
      div.appendChild(input);
      div.appendChild(actions);

      this.segmentsDiv.appendChild(div);
    });
  }

  async _export() {
    if (!this.projectId) return;
    if (this.cuts.length === 0) {
      this._log("No cuts to export.");
      return;
    }

    const payload = {
      segments: this.cuts.map((c) => ({
        start_s: c.start_s,
        end_s: c.end_s,
        filename: c.filename,
      })),
      bitrate_kbps: Number(this.bitrate.value),
    };

    this._log("Exporting...");
    const res = await this.api.export(this.projectId, payload);
    this._log(JSON.stringify(res, null, 2));
  }

  _log(text) {
    this.exportLog.textContent = text;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new CutterApp();
});
