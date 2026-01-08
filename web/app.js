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

    this.markerStart = document.getElementById("markerStart");
    this.markerEnd = document.getElementById("markerEnd");

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

    this.markerStart.classList.add("hidden");
    this.markerEnd.classList.add("hidden");

    this._refreshSelectionUi();

    if (this.wave) {
      this.wave.destroy();
    }

    const url = this.api.getAudioUrl(this.projectId);
    this.wave = WaveSurfer.create({
      container: "#waveform",
      height: 120,
      mediaControls: true,
      url: url,
    });

    this.wave.on("timeupdate", (t) => {
      this.timeInfo.textContent = TimeUtils.toClock(t);
    });

    this.wave.on("interaction", () => {
      this._handleWaveClick();
    });

    this.wave.on("ready", () => {
      this._setUiDisabled(false);
      this._updateOverlay(this.wave.getDuration());
      this._resetZoom();
      this._log("Audio loaded. Click waveform to set selection, then Add cut.");
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

    const duration = this.wave.getDuration();

    if (!Number.isFinite(this.selection.startS)) {
      this.selection.setStart(timeS);
      this.selection.clearEnd();
      this._syncSelectionUi(duration);
      return;
    }

    if (!Number.isFinite(this.selection.endS)) {
      this.selection.setEnd(timeS);
      this._syncSelectionUi(duration);
      return;
    }

    const boundary = this._pickBoundaryToMove(timeS);
    if (boundary === "start") {
      this.selection.setStart(timeS);
    } else {
      this.selection.setEnd(timeS);
    }

    this._syncSelectionUi(duration);
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

  _syncSelectionUi(duration) {
    this._refreshSelectionUi();
    this._updateOverlay(duration);

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

  _updateOverlay(duration) {
    if (!Number.isFinite(duration) || duration <= 0) return;

    const setMarker = (el, timeS) => {
      if (!Number.isFinite(timeS)) {
        el.classList.add("hidden");
        return;
      }
      const pct = Math.min(1, Math.max(0, timeS / duration)) * 100;
      el.style.left = `calc(${pct}% - 1px)`;
      el.classList.remove("hidden");
    };

    setMarker(this.markerStart, this.selection.startS);
    setMarker(this.markerEnd, this.selection.endS);
  }

  _resetSelection() {
    if (!this.wave) return;

    this.selection.reset();
    this.addCutBtn.disabled = true;
    this.resetSelectionBtn.disabled = true;

    this._refreshSelectionUi();
    this._updateOverlay(this.wave.getDuration());
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
    this._updateOverlay(duration);

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
