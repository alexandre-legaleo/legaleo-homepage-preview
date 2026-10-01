import React from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, sans, serif } from "./theme";
import { LeoIcon, LeoAnim } from "./LeoIcon";
import { Logo } from "./Logo";

// Vidéo marketing de Leo, l'agent IA de Legaleo (33 s, 1080p, 30 i/s).
// Six scènes qui se chevauchent de quelques images (fondus) :
//   1. Accroche : la question juridique du soir
//   2. Leo apparaît
//   3. Démo : une vraie question, les vrais états du badge Leo (legaleo-ai,
//      LeoBadge STATE_CONFIG), réponse sourcée, garde-fou avocat
//   4. Trois bénéfices
//   5. Leo propose, vous décidez, votre avocat valide
//   6. Logo + appel à l'action

const S = {
  hook: { from: 0, dur: 120 },
  reveal: { from: 110, dur: 130 },
  chat: { from: 230, dur: 340 },
  features: { from: 560, dur: 180 },
  trust: { from: 730, dur: 130 },
  cta: { from: 850, dur: 140 },
};
export const DURATION = S.cta.from + S.cta.dur;

const FADE = 12;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Fondu d'entrée et de sortie d'une scène (en images locales). */
const useSceneOpacity = (dur: number, first = false, last = false) => {
  const f = useCurrentFrame();
  const inO = first ? 1 : interpolate(f, [0, FADE], [0, 1], clamp);
  const outO = last ? 1 : interpolate(f, [dur - FADE, dur], [1, 0], clamp);
  return Math.min(inO, outO);
};

/** Ressort 0 → 1 démarrant à `delay` images. */
const usePop = (delay: number, config = { damping: 16, stiffness: 140, mass: 0.8 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - delay, fps, config });
};

/** Ligne de texte qui monte depuis sous sa ligne de base, masquée par son
 *  cadre (même geste que les titres du player de la homepage). */
const MaskLine: React.FC<{
  delay: number;
  out?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay, out, children, style }) => {
  const f = useCurrentFrame();
  const inY = interpolate(f, [delay, delay + 18], [110, 0], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const outY = out === undefined ? 0 : interpolate(f, [out, out + 14], [0, -110], { ...clamp, easing: Easing.in(Easing.cubic) });
  return (
    <div style={{ overflow: "hidden", padding: "0.12em 0 0.2em", margin: "-0.12em 0 -0.2em", ...style }}>
      <div style={{ transform: `translateY(${inY + outY}%)` }}>{children}</div>
    </div>
  );
};

const Beta: React.FC<{ size?: number; dark?: boolean }> = ({ size = 22, dark }) => (
  <span
    style={{
      display: "inline-block",
      borderRadius: 999,
      padding: `${size * 0.18}px ${size * 0.5}px`,
      color: dark ? C.lime : C.ink,
      background: dark ? C.ink : C.lime,
      fontFamily: sans,
      fontSize: size,
      fontWeight: 800,
      lineHeight: 1.2,
    }}
  >
    Bêta
  </span>
);

// ---------- 1. Accroche ----------
const Hook: React.FC = () => {
  const o = useSceneOpacity(S.hook.dur, true);
  return (
    <AbsoluteFill style={{ background: C.cream, opacity: o, alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill
        style={{ background: `radial-gradient(55% 45% at 50% 0%, rgba(98,231,235,0.18), transparent 70%)` }}
      />
      <div style={{ position: "absolute", fontFamily: serif, fontSize: 150, fontWeight: 500, letterSpacing: -4, color: C.ink }}>
        <MaskLine delay={4} out={48}>
          Il est 22 h 47.
        </MaskLine>
      </div>
      <div style={{ position: "absolute", textAlign: "center", width: 1500 }}>
        <MaskLine delay={56} style={{ fontFamily: serif, fontSize: 96, fontWeight: 500, letterSpacing: -2.5, color: C.ink, lineHeight: 1.08 }}>
          Une question juridique
        </MaskLine>
        <MaskLine delay={62} style={{ fontFamily: serif, fontSize: 96, fontWeight: 500, letterSpacing: -2.5, color: C.teal, lineHeight: 1.08 }}>
          sur votre réseau ?
        </MaskLine>
      </div>
    </AbsoluteFill>
  );
};

// ---------- 2. Leo apparaît ----------
const Reveal: React.FC = () => {
  const f = useCurrentFrame();
  const o = useSceneOpacity(S.reveal.dur);
  const icon = usePop(6, { damping: 12, stiffness: 120, mass: 0.9 });
  const beta = usePop(52);
  const halo = interpolate(f, [0, S.reveal.dur], [0.85, 1.15]);
  return (
    <AbsoluteFill
      style={{
        opacity: o,
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(60% 70% at 50% 45%, #0d5a57 0%, ${C.leo} 45%, #04211f 100%)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(98,231,235,0.22), transparent 62%)",
          transform: `scale(${halo})`,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
        <div style={{ transform: `scale(${0.4 + icon * 0.6}) rotate(${(1 - icon) * -25}deg)`, opacity: icon }}>
          <div style={{ borderRadius: 60, boxShadow: "0 0 0 1px rgba(98,231,235,0.35), 0 40px 90px -20px rgba(0,0,0,0.6)" }}>
            <LeoIcon size={230} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <MaskLine delay={22} style={{ fontFamily: serif, fontSize: 200, fontWeight: 500, letterSpacing: -6, color: C.cream, lineHeight: 1 }}>
            Leo
          </MaskLine>
          <div style={{ transform: `scale(${beta})`, opacity: beta }}>
            <Beta size={34} />
          </div>
        </div>
        <MaskLine delay={36} style={{ fontFamily: serif, fontStyle: "italic", fontSize: 60, fontWeight: 500, color: C.cyan, letterSpacing: -1 }}>
          le premier agent IA dédié à la franchise.
        </MaskLine>
      </div>
    </AbsoluteFill>
  );
};

// ---------- 3. Démo ----------
const QUESTION = "Quelles mentions obligatoires dans un DIP ?";
const ANSWER =
  "Le DIP réunit les mentions de l'article L.330-3 du Code de commerce : présentation du réseau et de son dirigeant, état du marché local, comptes annuels, engagements réciproques, durée et conditions de renouvellement… Je peux vous préparer la trame correspondante.";

// États du badge Leo (legaleo-ai : LeoBadge, STATE_CONFIG)
const STATES: { from: number; text: string; anim: LeoAnim; shimmer: boolean }[] = [
  { from: 78, text: "Réfléchit…", anim: "generating", shimmer: true },
  { from: 120, text: "Recherche sur Légifrance…", anim: "searching", shimmer: true },
  { from: 176, text: "Rédige la réponse…", anim: "generating", shimmer: true },
  { from: 282, text: "Réponse prête", anim: "done", shimmer: false },
];
const TYPE_FROM = 16;
const TYPE_TO = 62;
const STREAM_FROM = 190;
const STREAM_TO = 282;

// Texte d'état « en cours » : simple pulsation d'opacité. Pas de dégradé
// découpé sur le texte (background-clip: text), qui s'affichait parfois en
// rectangle plein au rendu.
const Shimmer: React.FC<{ text: string; on: boolean }> = ({ text, on }) => {
  const f = useCurrentFrame();
  const opacity = on ? 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(f / 5)) : 1;
  return <span style={{ color: C.leoText, opacity }}>{text}</span>;
};

const Chat: React.FC = () => {
  const f = useCurrentFrame();
  const o = useSceneOpacity(S.chat.dur);
  const card = usePop(0, { damping: 18, stiffness: 110, mass: 1 });
  const typed = Math.round(interpolate(f, [TYPE_FROM, TYPE_TO], [0, QUESTION.length], clamp));
  const sent = usePop(TYPE_TO + 6);
  const leoMsg = usePop(STATES[0].from - 6);
  const state = [...STATES].reverse().find((s) => f >= s.from);
  const words = ANSWER.split(" ");
  const shownWords = Math.round(interpolate(f, [STREAM_FROM, STREAM_TO], [0, words.length], clamp));
  const sources = usePop(STREAM_TO + 6);
  const guard = usePop(STREAM_TO + 22);
  // Caméra : léger rapprochement sur la réponse
  const zoom = interpolate(f, [0, S.chat.dur], [0.94, 1.03], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const lift = interpolate(f, [STREAM_FROM - 20, STREAM_TO + 30], [0, -40], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  // Le libellé s'efface avant que la carte remonte vers lui
  const caption = interpolate(f, [4, 22], [0, 1], clamp) * interpolate(f, [STREAM_FROM - 40, STREAM_FROM - 20], [1, 0], clamp);

  return (
    <AbsoluteFill
      style={{
        opacity: o,
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(50% 60% at 85% 20%, rgba(98,231,235,0.14), transparent 70%), ${C.ink}`,
        fontFamily: sans,
      }}
    >
      <div style={{ position: "absolute", top: 70, left: 110, opacity: caption, color: C.cyan, fontSize: 26, fontWeight: 800, letterSpacing: 4, textTransform: "uppercase" }}>
        Leo · Assistant IA
      </div>
      <div
        style={{
          width: 1180,
          transform: `translateY(${(1 - card) * 60 + lift}px) scale(${zoom})`,
          opacity: card,
          borderRadius: 34,
          border: "1px solid rgba(255,254,251,0.12)",
          background: "linear-gradient(160deg, rgba(255,254,251,0.07), rgba(255,254,251,0.03))",
          boxShadow: "0 60px 120px -40px rgba(0,0,0,0.7)",
          padding: 40,
          color: C.cream,
        }}
      >
        {/* En-tête */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, paddingBottom: 26, borderBottom: "1px solid rgba(255,254,251,0.1)" }}>
          <LeoIcon size={62} />
          <span style={{ fontSize: 34, fontWeight: 700 }}>Leo</span>
          <span style={{ fontSize: 30, fontWeight: 500, color: "rgba(255,254,251,0.55)" }}>Assistant IA</span>
          <span style={{ marginLeft: "auto" }}>
            <Beta size={22} />
          </span>
        </div>

        {/* Question */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 34 }}>
          <div
            style={{
              borderRadius: 22,
              padding: "20px 28px",
              background: f >= TYPE_TO + 6 ? C.cream : "rgba(255,254,251,0.1)",
              color: f >= TYPE_TO + 6 ? C.ink : C.cream,
              fontSize: 34,
              fontWeight: 600,
              transform: `scale(${f >= TYPE_TO + 6 ? 0.96 + sent * 0.04 : 1})`,
              transformOrigin: "right center",
              minHeight: 44,
            }}
          >
            {QUESTION.slice(0, typed)}
            {f < TYPE_TO + 6 && (
              <span style={{ display: "inline-block", width: 3, height: 36, marginLeft: 3, background: C.cyan, verticalAlign: -6, opacity: Math.floor(f / 8) % 2 ? 0.2 : 1 }} />
            )}
          </div>
        </div>

        {/* Réponse de Leo */}
        <div
          style={{
            marginTop: 30,
            maxWidth: 960,
            borderRadius: 24,
            border: "1px solid rgba(98,231,235,0.2)",
            background: "rgba(98,231,235,0.07)",
            padding: "26px 30px",
            opacity: leoMsg,
            transform: `translateY(${(1 - leoMsg) * 24}px)`,
          }}
        >
          {state && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                height: 54,
                borderRadius: 11,
                padding: "0 18px 0 8px",
                background: C.leo,
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              <div style={{ width: 40, height: 40 }}>
                <LeoIcon key={state.anim} size={40} anim={state.anim} loop={state.anim !== "done"} radius={8} />
              </div>
              <Shimmer text={state.text} on={state.shimmer} />
            </div>
          )}
          {shownWords > 0 && (
            <p style={{ margin: "22px 0 0", fontSize: 31, lineHeight: 1.5, color: "rgba(255,254,251,0.92)", fontWeight: 500 }}>
              {words.slice(0, shownWords).join(" ")}
            </p>
          )}
          {f >= STREAM_TO + 6 && (
            <div style={{ display: "flex", gap: 14, marginTop: 24, opacity: sources, transform: `translateY(${(1 - sources) * 14}px)` }}>
              {["Légifrance · Art. L.330-3 C. com.", "Art. R.330-1 C. com."].map((src) => (
                <span
                  key={src}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    borderRadius: 999,
                    border: "1px solid rgba(98,231,235,0.35)",
                    padding: "9px 18px",
                    color: C.cyan,
                    fontSize: 22,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: C.cyan }} />
                  {src}
                </span>
              ))}
            </div>
          )}
          {f >= STREAM_TO + 22 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginTop: 24,
                paddingTop: 20,
                borderTop: "1px solid rgba(255,254,251,0.1)",
                color: C.lime,
                fontSize: 25,
                fontWeight: 700,
                opacity: guard,
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.lime} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              Point qui engage votre réseau : à valider avec votre avocat dédié
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- 4. Trois bénéfices ----------
const FEATURES: { anim: LeoAnim; title: string; text: string }[] = [
  { anim: "scan", title: "Répond en quelques secondes", text: "Vos questions du quotidien, replacées dans le contexte précis de la franchise." },
  { anim: "searching", title: "Cite ses sources", text: "Code de commerce, Légifrance : chaque réponse est sourcée et vérifiable." },
  { anim: "idle", title: "Vous guide pas à pas", text: "De l'onboarding à vos premiers DIP et contrats de franchise." },
];

const FeatureCard: React.FC<{ i: number }> = ({ i }) => {
  const p = usePop(18 + i * 12);
  const { anim, title, text } = FEATURES[i];
  return (
    <div
      style={{
        width: 500,
        borderRadius: 32,
        border: "1px solid #e6e0d3",
        background: "#ffffff",
        boxShadow: "0 40px 80px -40px rgba(31,18,14,0.35)",
        padding: 44,
        opacity: p,
        transform: `translateY(${(1 - p) * 80}px) rotate(${(1 - p) * (i - 1) * 4}deg)`,
      }}
    >
      <LeoIcon size={96} anim={anim} />
      <div style={{ marginTop: 32, fontFamily: serif, fontSize: 44, fontWeight: 600, lineHeight: 1.1, letterSpacing: -1, color: C.ink }}>{title}</div>
      <div style={{ marginTop: 18, fontFamily: sans, fontSize: 26, lineHeight: 1.5, color: C.muted, fontWeight: 500 }}>{text}</div>
    </div>
  );
};

const Features: React.FC = () => {
  const o = useSceneOpacity(S.features.dur);
  return (
    <AbsoluteFill style={{ opacity: o, background: C.beige, alignItems: "center", justifyContent: "center", gap: 70 }}>
      <AbsoluteFill style={{ background: "radial-gradient(50% 50% at 50% 100%, rgba(98,231,235,0.18), transparent 70%)" }} />
      <div style={{ textAlign: "center" }}>
        <MaskLine delay={2} style={{ fontFamily: sans, fontSize: 26, fontWeight: 800, letterSpacing: 4, color: C.teal, textTransform: "uppercase" }}>
          Votre copilote juridique
        </MaskLine>
        <MaskLine delay={8} style={{ marginTop: 14, fontFamily: serif, fontSize: 84, fontWeight: 500, letterSpacing: -2.5, color: C.ink }}>
          Au quotidien, <span style={{ color: C.teal, fontFamily: serif, fontStyle: "italic" }}>dans votre réseau.</span>
        </MaskLine>
      </div>
      <div style={{ display: "flex", gap: 40 }}>
        {FEATURES.map((_, i) => (
          <FeatureCard key={i} i={i} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ---------- 5. Leo propose, vous décidez, votre avocat valide ----------
const Trust: React.FC = () => {
  const o = useSceneOpacity(S.trust.dur);
  const line: React.CSSProperties = { fontFamily: serif, fontSize: 128, fontWeight: 500, letterSpacing: -4, lineHeight: 1.05 };
  return (
    <AbsoluteFill
      style={{
        opacity: o,
        justifyContent: "center",
        paddingLeft: 200,
        background: `radial-gradient(55% 60% at 90% 90%, rgba(98,231,235,0.16), transparent 70%), ${C.leo}`,
        color: C.cream,
      }}
    >
      <MaskLine delay={6} style={line}>
        Leo propose.
      </MaskLine>
      <MaskLine delay={26} style={line}>
        Vous décidez.
      </MaskLine>
      <MaskLine delay={46} style={{ ...line, fontFamily: serif, fontStyle: "italic", color: C.cyan }}>
        Votre avocat valide.
      </MaskLine>
      <MaskLine delay={70} style={{ marginTop: 44, fontFamily: sans, fontSize: 32, fontWeight: 600, color: "rgba(255,254,251,0.7)", maxWidth: 1100, textWrap: "balance" }}>
        Tout ce qui engage votre réseau reste validé par un avocat dédié au droit de la franchise.
      </MaskLine>
    </AbsoluteFill>
  );
};

// ---------- 6. Appel à l'action ----------
const Cta: React.FC = () => {
  const f = useCurrentFrame();
  const o = useSceneOpacity(S.cta.dur, false, true);
  const logo = usePop(4);
  const btn = usePop(40, { damping: 11, stiffness: 150, mass: 0.8 });
  const glow = interpolate(f, [0, S.cta.dur], [0.9, 1.1]);
  return (
    <AbsoluteFill style={{ opacity: o, background: C.cream, alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(40% 40% at 50% 55%, rgba(98,231,235,0.22), transparent 70%)",
          transform: `scale(${glow})`,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 46 }}>
        <div style={{ opacity: logo, transform: `translateY(${(1 - logo) * 30}px)` }}>
          <Logo height={110} />
        </div>
        <div style={{ textAlign: "center" }}>
          <MaskLine delay={14} style={{ fontFamily: serif, fontSize: 80, fontWeight: 500, letterSpacing: -2.5, color: C.ink }}>
            Leo, <span style={{ color: C.teal }}>le premier agent IA</span>
          </MaskLine>
          <MaskLine delay={20} style={{ fontFamily: serif, fontSize: 80, fontWeight: 500, letterSpacing: -2.5, color: C.teal }}>
            dédié à la franchise.
          </MaskLine>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            borderRadius: 999,
            padding: "26px 44px",
            background: C.cyan,
            color: C.ink,
            fontFamily: sans,
            fontSize: 36,
            fontWeight: 700,
            transform: `scale(${btn})`,
            opacity: Math.min(1, btn * 2),
            boxShadow: "0 30px 60px -24px rgba(8,127,131,0.6)",
          }}
        >
          Découvrir Leo <Beta size={22} dark />
        </div>
        <MaskLine delay={56} style={{ fontFamily: sans, fontSize: 30, fontWeight: 600, color: C.muted, letterSpacing: 1 }}>
          legaleo.ai
        </MaskLine>
      </div>
    </AbsoluteFill>
  );
};

export const LeoPromo: React.FC = () => (
  <AbsoluteFill style={{ background: C.cream }}>
    <Sequence from={S.hook.from} durationInFrames={S.hook.dur}>
      <Hook />
    </Sequence>
    <Sequence from={S.reveal.from} durationInFrames={S.reveal.dur}>
      <Reveal />
    </Sequence>
    <Sequence from={S.chat.from} durationInFrames={S.chat.dur}>
      <Chat />
    </Sequence>
    <Sequence from={S.features.from} durationInFrames={S.features.dur}>
      <Features />
    </Sequence>
    <Sequence from={S.trust.from} durationInFrames={S.trust.dur}>
      <Trust />
    </Sequence>
    <Sequence from={S.cta.from} durationInFrames={S.cta.dur}>
      <Cta />
    </Sequence>
  </AbsoluteFill>
);
