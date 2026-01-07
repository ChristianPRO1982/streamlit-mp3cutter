from dataclasses import dataclass

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from streamlit_plotly_events import plotly_events

from app.core.waveform_service import WaveformEnvelope


@dataclass(frozen=True)
class Marker:
    """Represent a marker displayed on the waveform."""

    time_s: float
    label: str


class MarkersView:
    """Render waveform and allow manual marker editing."""

    def __init__(self) -> None:
        """Initialize view."""
        self._state_key = "markers"
        self._click_key = "waveform_click"

    def render(self, envelope: WaveformEnvelope) -> list[Marker]:
        """Render waveform + markers editor and return markers."""
        self._sync_clicked_time_to_input()

        st.subheader("Markers")

        self._render_add_marker(envelope)

        markers = self._get_markers()
        markers = self._render_editor(markers, envelope)

        self._set_markers(markers)
        self._render_plot(envelope, markers)

        return self._get_markers()


    def _render_add_marker(self, envelope: WaveformEnvelope) -> None:
        """Render a small form to add a marker."""
        col1, col2, col3 = st.columns([2, 2, 1])

        with col1:
            st.text_input("Label", value="deb1", key="marker_label")

        with col2:
            st.number_input(
                "Time (s)",
                min_value=0.0,
                max_value=float(envelope.times_s[-1]),
                value=float(st.session_state.get("marker_time_s", 0.0)),
                step=0.5,
                key="marker_time_s",
            )

        with col3:
            if st.button("Add marker"):
                self._append_marker(
                    time_s=float(st.session_state.get("marker_time_s", 0.0)),
                    label=str(st.session_state.get("marker_label", "deb1")),
                )

    def _get_markers(self) -> list[Marker]:
        """Read markers from session state."""
        raw = st.session_state.get(self._state_key, [])
        return [Marker(time_s=m["time_s"], label=m["label"]) for m in raw]

    def _set_markers(self, markers: list[Marker]) -> None:
        """Write markers to session state."""
        st.session_state[self._state_key] = [
            {"time_s": float(m.time_s), "label": str(m.label)} for m in markers
        ]

    def _append_marker(self, time_s: float, label: str) -> None:
        """Append a marker into session state."""
        markers = st.session_state.get(self._state_key, [])
        markers.append({"time_s": float(time_s), "label": str(label)})
        markers.sort(key=lambda x: x["time_s"])
        st.session_state[self._state_key] = markers

    def _render_editor(
        self,
        markers: list[Marker],
        envelope: WaveformEnvelope,
    ) -> list[Marker]:
        """Render a data editor to update markers."""
        if not markers:
            st.caption("No markers yet. Add `deb1`, `fin1`, etc. (or click the waveform).")
            return markers

        df = pd.DataFrame([{"time_s": m.time_s, "label": m.label} for m in markers])

        edited = st.data_editor(
            df,
            num_rows="dynamic",
            use_container_width=True,
            column_config={
                "time_s": st.column_config.NumberColumn(
                    "time_s",
                    min_value=0.0,
                    max_value=float(envelope.times_s[-1]),
                    step=0.1,
                ),
                "label": st.column_config.TextColumn("label"),
            },
            key="markers_editor",
        )

        cleaned = self._clean_df(edited)
        cleaned.sort_values("time_s", inplace=True)

        return [
            Marker(time_s=float(r.time_s), label=str(r.label))
            for r in cleaned.itertuples()
        ]

    def _clean_df(self, df: pd.DataFrame) -> pd.DataFrame:
        """Normalize and validate marker rows."""
        df = df.copy()
        df["label"] = df["label"].fillna("").astype(str).str.strip()
        df = df[df["label"] != ""]
        df["time_s"] = pd.to_numeric(df["time_s"], errors="coerce")
        df = df.dropna(subset=["time_s"])
        return df

    def _render_plot(self, envelope: WaveformEnvelope, markers: list[Marker]) -> None:
        """Render waveform plot with marker lines and labels."""
        x_values = envelope.times_s.tolist()
        y_values = envelope.values.tolist()

        fig = go.Figure()
        fig.add_trace(
            go.Scatter(
                x=x_values,
                y=y_values,
                mode="lines",
                name="waveform",
                fill="tozeroy",
            )
        )

        for m in markers:
            fig.add_vline(x=float(m.time_s))
            fig.add_annotation(
                x=float(m.time_s),
                y=1.0,
                yref="paper",
                text=m.label,
                showarrow=False,
                yanchor="bottom",
            )

        fig.update_layout(
            height=320,
            margin=dict(l=10, r=10, t=10, b=10),
            xaxis_title="Time (s)",
            yaxis_title="Volume",
            clickmode="event+select",
        )

        events = plotly_events(
            fig,
            click_event=True,
            select_event=False,
            hover_event=False,
            key=self._click_key,
            override_height=320,
        )

        # st.write(events)

        self._apply_click(events, envelope)

    def _apply_click(self, events: list[dict], envelope: WaveformEnvelope) -> None:
        """Store clicked time and rerun to update inputs."""
        if not events:
            return

        x_value = events[0].get("x")
        if x_value is None:
            return

        clicked = float(x_value)
        clicked = max(0.0, min(clicked, float(envelope.times_s[-1])))

        st.session_state["clicked_time_s"] = clicked
        st.rerun()

    
    def _sync_clicked_time_to_input(self) -> None:
        """Sync clicked time to the marker input before widgets are created."""
        if "clicked_time_s" not in st.session_state:
            return

        clicked = float(st.session_state["clicked_time_s"])
        st.session_state["marker_time_s"] = clicked
        st.session_state.pop("clicked_time_s", None)

