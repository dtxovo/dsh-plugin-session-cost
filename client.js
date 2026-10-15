window.__ModuleLoader__.load({
	id: "dsh-plugin-session-cost",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let reactDom = require("react-dom");
		//#region lib/dictionaries.js
		/** Dictionary namespace owned by this plugin. */
		const NS = "sessionCost";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"cost.label": "花费",
			"cost.title": "本会话累计花费（按峰谷价目表估算）",
			"tier.peak": "高峰时段",
			"tier.offPeak": "空闲时段",
			"tier.requests": "{count} 次请求",
			"tier.peak.hint": "北京时间周一至周五 09:00-12:00、14:00-18:00",
			"tier.offPeak.hint": "其余时段，含周末与节假日",
			"row.miss": "未缓存输入",
			"row.hit": "缓存读取",
			"row.write": "缓存写入",
			"row.output": "输出",
			"row.subtotal": "小计",
			"value.tokens": "{tokens} tok"
		};
		/** English dictionary, key-identical to the Chinese source of truth. */
		const en = {
			"cost.label": "Cost",
			"cost.title": "Running spend for this session, priced by the peak/off-peak rate table",
			"tier.peak": "Peak",
			"tier.offPeak": "Off-peak",
			"tier.requests": "{count} requests",
			"tier.peak.hint": "Beijing time Mon-Fri 09:00-12:00 and 14:00-18:00",
			"tier.offPeak.hint": "Every other hour, weekends and holidays included",
			"row.miss": "Uncached input",
			"row.hit": "Cache read",
			"row.write": "Cache write",
			"row.output": "Output",
			"row.subtotal": "Subtotal",
			"value.tokens": "{tokens} tok"
		};
		//#endregion
		//#region lib/theme.js
		/*
		 * Metrics are copied from the shipped chat surfaces (the trigger from
		 * TurnUsagePanel, the panel from stat-dialog) so this entry sits in the same
		 * visual language as the native stats row. Two deliberate departures:
		 *
		 * 1. Everything is an inline style. `dsh-client-modules` adopts every
		 *    UNTAGGED <style> for whichever plugin materializes next, and
		 *    `dsh-client-hmr` then deletes a plugin's adopted tags on reload, so an
		 *    injected sheet is not a dependable place for anything load-bearing.
		 *    Hover is driven by React state for the same reason: a :hover rule
		 *    cannot survive a sheet that may be taken away.
		 * 2. Every custom property carries a fallback. A `var()` that resolves to
		 *    nothing makes the whole declaration invalid at computed-value time, so
		 *    a missing token silently turns a popover background transparent.
		 *    Ask the Theme Inspect provider for the live token names, not these.
		 */
		/**
		 * The panel's paint, in two layers so it cannot come out see-through.
		 *
		 * `backgroundColor` is a surface token and therefore opaque by definition.
		 * The menu tint rides on top as a gradient rather than as `background`,
		 * because a single colour cannot be layered: if the tint token resolves it
		 * covers the base and the panel matches the shipped dialog exactly, and if
		 * it resolves to a translucent colour or to nothing at all the base still
		 * shows, so the worst case is a flat panel rather than a window.
		 */
		const PANEL_BASE = "var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))";
		const PANEL_TINT = "linear-gradient(var(--dsw-specific-menu, transparent), var(--dsw-specific-menu, transparent))";
		/** Hover / expanded fill. Falls back to the nested-surface background. */
		const HOVER_BG = "var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2))";
		/** Resting label colour, and the details-text colour. */
		const LABEL_TERTIARY = "var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))";
		const LABEL_SECONDARY = "var(--dsw-alias-label-secondary)";
		const LABEL_PRIMARY = "var(--dsw-alias-label-primary)";
		const BORDER_L2 = "var(--dsw-alias-border-l2, var(--dsw-alias-border-l1))";
		/**
		 * Pill text size, pinned rather than taken from the reading-size variable.
		 * The shipped pill's own CSS fallback is 13px; the icon and the label carry
		 * the meaning here, so stepping one notch down keeps this entry quieter than
		 * the usage pill it sits beside instead of competing with it.
		 */
		const PILL_FONT_SIZE = "12px";
		/**
		 * The trigger mirrors the shipped usage pill (`StatsPills.module.css`,
		 * `.bOPqQW_pill`) rather than TurnUsagePanel's trigger, because that usage
		 * pill is the thing this entry actually sits beside in the dock. The two
		 * differ in ways that read as "bigger": the usage pill pins its icon at
		 * 14px, pads 1px 8px, rounds 24px, sets no height, and takes its font from
		 * `font: inherit`; TurnUsagePanel's trigger uses 15px + delta, pads
		 * 6px 8px, rounds 28px, and fixes a 28px + delta height.
		 *
		 * The label is the bare amount, exactly as the shipped pill carries only a
		 * value and leaves the wording to its dialog title: two Han glyphs weigh far
		 * more than digits at the same size, so a word label made this pill read as
		 * the largest thing in the row.
		 */
		const S_TRIGGER = {
			minWidth: 0,
			boxSizing: "border-box",
			color: LABEL_TERTIARY,
			fontFamily: "inherit",
			fontSize: PILL_FONT_SIZE,
			fontWeight: "inherit",
			fontVariantNumeric: "tabular-nums",
			lineHeight: "18px",
			whiteSpace: "nowrap",
			cursor: "pointer",
			background: "none",
			border: "none",
			borderRadius: "24px",
			alignItems: "center",
			gap: "6px",
			padding: "1px 8px",
			display: "inline-flex"
		};
		const S_TRIGGER_ACTIVE = { ...S_TRIGGER, background: HOVER_BG, color: LABEL_SECONDARY };
		const S_ROOT = { minWidth: 0, display: "inline-flex" };
		const S_ICON_TRIGGER = { width: "13px", height: "13px", flex: "none" };
		const S_ICON_TITLE = { width: "14px", height: "14px", flex: "none" };
		const S_LABEL = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" };
		const S_PANEL = {
			position: "fixed",
			zIndex: 1100,
			boxSizing: "border-box",
			backgroundColor: PANEL_BASE,
			backgroundImage: PANEL_TINT,
			"--dsw-elevation-stroke-color": "var(--dsw-alias-border-l1)",
			width: "max-content",
			minWidth: "min(300px, 100vw - 24px)",
			maxWidth: "min(440px, 100vw - 24px)",
			boxShadow: "var(--dsw-elevation-prominent, 0 10px 30px rgb(0 0 0 / 0.35), 0 0 0 1px var(--dsw-alias-border-l1))",
			color: LABEL_SECONDARY,
			cursor: "default",
			border: 0,
			borderRadius: "12px",
			padding: "16px",
			fontSize: "12px",
			lineHeight: "18px"
		};
		const S_TITLE = { display: "flex", justifyContent: "space-between", gap: "16px", marginBottom: "8px", fontWeight: 500, color: LABEL_PRIMARY };
		const S_TITLE_LABEL = { display: "inline-flex", alignItems: "center", gap: "6px", minWidth: 0 };
		const S_TITLE_VALUE = { fontVariantNumeric: "tabular-nums" };
		const S_TITLE_RULE = { borderTop: "0.5px solid " + BORDER_L2, marginBottom: "10px" };
		const S_DETAILS = {
			display: "grid",
			gridTemplateColumns: "minmax(76px,auto) minmax(0,1fr)",
			gap: "6px 16px",
			margin: 0,
			color: LABEL_TERTIARY
		};
		const S_DT = { minWidth: 0, margin: 0 };
		const S_DD = { minWidth: 0, margin: 0, color: LABEL_SECONDARY, fontVariantNumeric: "tabular-nums", textAlign: "right" };
		const S_TIER = { ...S_DT, gridColumn: "1 / -1", color: LABEL_SECONDARY };
		const S_SUBTOTAL = { ...S_DT, color: LABEL_SECONDARY };
		const S_SUBTOTAL_VALUE = { ...S_DD };
		//#endregion
		//#region lib/icons.js
		/** A ¥ inside a coin, drawn the way the shipped 16px stroke icons are. */
		function CoinIcon(props) {
			return react.createElement("svg", {
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				style: props?.style
			}, react.createElement("circle", {
				cx: 8,
				cy: 8,
				r: 6.25,
				stroke: "currentColor",
				strokeWidth: 1.4
			}), react.createElement("path", {
				d: "M5.7 5.5 8 8.5l2.3-3M8 8.5V11.2M6.3 9h3.4M6.3 10.1h3.4",
				stroke: "currentColor",
				strokeWidth: 1.2,
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}));
		}
		//#endregion
		//#region lib/format.js
		/** Format a money amount, widening precision as the amount shrinks. */
		function formatMoney(value, currency) {
			if (!Number.isFinite(value)) return "--";
			if (value <= 0) return currency + "0";
			if (value < 0.01) return "<" + currency + "0.01";
			if (value < 1) return currency + value.toFixed(3);
			if (value < 100) return currency + value.toFixed(2);
			return currency + Math.round(value).toLocaleString();
		}
		/** Format a token count the way the shipped usage dialog does: K/M with a fixed precision. */
		function formatTokens(value) {
			if (!Number.isFinite(value) || value <= 0) return "0";
			if (value < 1000) return String(Math.round(value));
			if (value < 100000) return (value / 1000).toFixed(1) + "K";
			if (value < 1000000) return (value / 1000).toFixed(0) + "K";
			return (value / 1000000).toFixed(2) + "M";
		}
		/** Coerce a possibly-missing numeric field to a safe non-negative number. */
		function num(value) {
			return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
		}
		/** Substitute {name} placeholders in one dictionary entry. */
		function interpolate(text, params) {
			if (params === null || typeof params !== "object") return text;
			let out = text;
			for (const name of Object.keys(params)) out = out.split("{" + name + "}").join(String(params[name]));
			return out;
		}
		/** Stand-in for the slot's `t` seat, used only if the renderer hands none. */
		function fallbackTranslate(key, params) {
			const text = Object.prototype.hasOwnProperty.call(zh, key) ? zh[key] : key;
			return interpolate(text, params);
		}
		//#endregion
		//#region lib/position.js
		/** Gap between the trigger and its panel, matching the shipped stat dialog. */
		const PANEL_GAP = 8;
		/** Minimum distance the panel keeps from every viewport edge. */
		const PANEL_MARGIN = 12;
		/**
		 * Anchor the panel above its trigger, clamped to the viewport, re-measured
		 * on resize and on any scroll. Returns null until the first measurement, so
		 * the panel can stay invisible for that one frame instead of flashing at
		 * its unpositioned origin.
		 */
		function useAnchoredPosition(open, anchorRef, panelRef) {
			const [pos, setPos] = react.useState(null);
			react.useEffect(() => {
				if (!open) {
					setPos(null);
					return;
				}
				const place = () => {
					const anchor = anchorRef.current;
					const panel = panelRef.current;
					if (anchor === null || panel === null) return;
					const a = anchor.getBoundingClientRect();
					const p = panel.getBoundingClientRect();
					let top = a.top - PANEL_GAP - p.height;
					if (top < PANEL_MARGIN) top = a.bottom + PANEL_GAP;
					top = Math.max(PANEL_MARGIN, Math.min(top, window.innerHeight - p.height - PANEL_MARGIN));
					const left = Math.max(PANEL_MARGIN, Math.min(a.left, window.innerWidth - p.width - PANEL_MARGIN));
					setPos({ top, left });
				};
				place();
				window.addEventListener("resize", place);
				window.addEventListener("scroll", place, true);
				return () => {
					window.removeEventListener("resize", place);
					window.removeEventListener("scroll", place, true);
				};
			}, [open, anchorRef, panelRef]);
			return pos;
		}
		/** Close on an outside pointer or Escape, matching the shipped stat dialog. */
		function useDismiss(open, rootRef, panelRef, close) {
			react.useEffect(() => {
				if (!open) return;
				const onPointer = event => {
					if (rootRef.current?.contains(event.target) === true) return;
					if (panelRef.current?.contains(event.target) === true) return;
					close();
				};
				const onKeyDown = event => {
					if (event.key === "Escape") close();
				};
				document.addEventListener("pointerdown", onPointer, true);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointer, true);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open, rootRef, panelRef, close]);
		}
		//#endregion
		//#region lib/SessionCost.js
		/** Bucket ids in display order. */
		const BUCKETS = ["miss", "hit", "write", "output"];
		/** Which rate field bills each bucket. */
		const RATE_FIELD = {
			miss: "input",
			hit: "cacheRead",
			write: "cacheWrite",
			output: "output"
		};
		/**
		 * The composer cost entry: a native-styled pill next to the shipped stats
		 * row, opening a native-styled panel that splits the session's spend by
		 * peak and off-peak tier. The host half decides each request's tier from
		 * its own timestamp, so this half only renders.
		 * @param props - slot props: the framework's `useProjection` hook and this plugin's locale seat.
		 * @returns the trigger and, while open, its portaled panel.
		 */
		function SessionCost({ useProjection, t: translate }) {
			const value = useProjection("sessionCost");
			const [open, setOpen] = react.useState(false);
			const [hover, setHover] = react.useState(false);
			const rootRef = react.useRef(null);
			const panelRef = react.useRef(null);
			const t = typeof translate === "function" ? translate : fallbackTranslate;
			const close = react.useCallback(() => setOpen(false), []);
			const pos = useAnchoredPosition(open, rootRef, panelRef);
			useDismiss(open, rootRef, panelRef, close);
			if (value === undefined) return null;

			const currency = typeof value.currency === "string" && value.currency.length > 0 ? value.currency : "¥";
			const per = num(value.per) || 1000000;
			const total = num(value.total);
			const tiers = [];
			if (num(value.peak?.requests) > 0) tiers.push({ id: "peak", data: value.peak, rates: value.rates?.peak });
			if (num(value.offPeak?.requests) > 0) tiers.push({ id: "offPeak", data: value.offPeak, rates: value.rates?.offPeak });

			const children = [react.createElement("button", {
				type: "button",
				key: "trigger",
				className: "dsc-trigger",
				style: hover || open ? S_TRIGGER_ACTIVE : S_TRIGGER,
				"aria-haspopup": "dialog",
				"aria-expanded": open,
				title: t("cost.title"),
				onClick: () => setOpen(!open),
				onMouseEnter: () => setHover(true),
				onMouseLeave: () => setHover(false),
				onFocus: () => setHover(true),
				onBlur: () => setHover(false)
			}, react.createElement(CoinIcon, {
				key: "icon",
				style: S_ICON_TRIGGER
			}), react.createElement("span", {
				key: "label",
				className: "dsc-label",
				style: S_LABEL
			}, formatMoney(total, currency)))];

			if (open) {
				const rows = [];
				tiers.forEach((tier, index) => {
					rows.push(react.createElement("dt", {
						key: tier.id,
						className: "dsc-tier",
						style: index === 0 ? S_TIER : { ...S_TIER, paddingTop: "2px" },
						title: t("tier." + tier.id + ".hint")
					}, t("tier." + tier.id) + " · " + t("tier.requests", { count: num(tier.data.requests) })));
					for (const bucket of BUCKETS) {
						const tokens = num(tier.data[bucket]);
						if (tokens <= 0) continue;
						const money = tokens * num(tier.rates?.[RATE_FIELD[bucket]]) / per;
						rows.push(react.createElement("dt", {
							key: tier.id + "-" + bucket,
							style: S_DT
						}, t("row." + bucket)));
						rows.push(react.createElement("dd", {
							key: tier.id + "-" + bucket + "-v",
							style: S_DD
						}, t("value.tokens", { tokens: formatTokens(tokens) }) + " · " + formatMoney(money, currency)));
					}
					if (tiers.length > 1) {
						rows.push(react.createElement("dt", {
							key: tier.id + "-sub",
							style: S_SUBTOTAL
						}, t("row.subtotal")));
						rows.push(react.createElement("dd", {
							key: tier.id + "-sub-v",
							style: S_SUBTOTAL_VALUE
						}, formatMoney(num(tier.data.cost), currency)));
					}
				});
				children.push(reactDom.createPortal(react.createElement("div", {
					ref: panelRef,
					className: "dsc-panel",
					role: "dialog",
					style: pos === null
						? { ...S_PANEL, top: 0, left: 0, visibility: "hidden" }
						: { ...S_PANEL, top: pos.top, left: pos.left }
				}, react.createElement("div", {
					className: "dsc-title",
					style: S_TITLE
				}, react.createElement("span", {
					className: "dsc-titleLabel",
					style: S_TITLE_LABEL
				}, react.createElement(CoinIcon, {
					key: "icon",
					style: S_ICON_TITLE
				}), t("cost.label")), react.createElement("span", {
					className: "dsc-titleValue",
					style: S_TITLE_VALUE
				}, formatMoney(total, currency))), react.createElement("div", {
					className: "dsc-titleRule",
					style: S_TITLE_RULE
				}), react.createElement("dl", {
					className: "dsc-details",
					style: S_DETAILS
				}, ...rows)), document.body));
			}

			return react.createElement("span", {
				className: "dsc-root",
				style: S_ROOT,
				ref: rootRef
			}, ...children);
		}
		//#endregion
		//#region lib/index.js
		/** The composer dock owns the seat; the locale registry owns the copy. */
		const inject = ["slots", "locale"];
		/**
		 * Client plugin body: register the dictionaries and claim the ambient row
		 * below the composer card. No stylesheet: every metric is an inline style,
		 * so nothing here depends on a <style> tag surviving adopt-and-delete.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "session-cost: dictionaries");
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "session-cost",
				order: 20,
				locale: NS
			}, SessionCost));
		}
		//#endregion
		exports.SessionCost = SessionCost;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
