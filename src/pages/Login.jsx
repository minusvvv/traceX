import {useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {Eye, EyeOff, ShieldCheck, User} from "lucide-react";
import TraceXLogo from "../components/brand/TraceXLogo.jsx";
import CTAButton from "../components/common/CTAButton.jsx";
import Scene from "../components/story/Scene.jsx";
import {HOME, useAuth} from "../auth/AuthContext.jsx";
import useMeta from "../hooks/useMeta.js";

// Defined at module level on purpose: declaring it inside Login remounted the input on every keystroke and dropped focus.
const F = ({id, label, type = "text", ph, v, set, ac, right, hint, minLength}) => (
  <div>
    <div className="flex justify-between items-baseline">
      <label htmlFor={id} className="text-sm text-off/70">{label}</label>
      {hint && <span className="text-xs text-off/50">{hint}</span>}
    </div>
    <div className="relative">
      <input
        id={id}
        type={type}
        value={v}
        onChange={e => set(e.target.value)}
        autoComplete={ac}
        required
        minLength={minLength}
        placeholder={ph}
        className={`mt-1 w-full bg-transparent border-b border-off/30 focus:border-cream outline-none py-2 text-off placeholder:text-off/30 ${right ? "pr-9" : ""}`}
      />
      {right}
    </div>
  </div>
);

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const {login, consumerLogin, registerConsumer} = useAuth();
  const {meta} = useMeta();

  // Active tab: "consumer" (first) | "staff"
  const [tab, setTab] = useState("consumer");
  // Consumer mode: "login" | "register"
  const [consumerMode, setConsumerMode] = useState("login");

  // Form states
  const [name, setName] = useState("");
  const [em, setEm] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setErr(null);
    setPw("");
  };

  const handleTabChange = newTab => {
    setTab(newTab);
    resetForm();
  };

  const submitStaff = async e => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const u = await login(em.trim(), pw);
      nav(loc.state?.from || HOME[u.role] || "/dashboard", {replace: true});
    } catch (x) {
      setErr(x.fields && Object.keys(x.fields).length ? Object.values(x.fields).join(". ") : (x.message || "Failed to sign in"));
    } finally {
      setBusy(false);
    }
  };

  const submitConsumer = async e => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      let u;
      if (consumerMode === "register") {
        u = await registerConsumer({name: name.trim(), email: em.trim(), password: pw});
      } else {
        u = await consumerLogin(em.trim(), pw);
      }
      nav(loc.state?.from || HOME[u.role] || "/consumer/map", {replace: true});
    } catch (x) {
      setErr(x.fields && Object.keys(x.fields).length ? Object.values(x.fields).join(". ") : (x.message || "Authentication failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-deep text-off">
      <div className="p-8 md:p-16 flex flex-col justify-between">
        <TraceXLogo />

        <div className="my-auto max-w-sm w-full space-y-6">
          {/* Tab selector: Consumer first, then Staff Sign in */}
          <div className="flex border-b border-off/20 pb-1 gap-6">
            <button
              type="button"
              onClick={() => handleTabChange("consumer")}
              className={`flex items-center gap-2 pb-2 text-sm font-medium transition-colors border-b-2 -mb-[5px] ${
                tab === "consumer"
                  ? "border-cream text-cream font-semibold"
                  : "border-transparent text-off/60 hover:text-off"
              }`}
            >
              <User size={16} /> Consumer Sign in
            </button>
            <button
              type="button"
              onClick={() => handleTabChange("staff")}
              className={`flex items-center gap-2 pb-2 text-sm font-medium transition-colors border-b-2 -mb-[5px] ${
                tab === "staff"
                  ? "border-cream text-cream font-semibold"
                  : "border-transparent text-off/60 hover:text-off"
              }`}
            >
              <ShieldCheck size={16} /> Staff Sign in
            </button>
          </div>

          {tab === "consumer" ? (
            <form onSubmit={submitConsumer} className="space-y-6">
              <div>
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
                  {consumerMode === "register" ? "Create an account" : "Sign in"}
                </h1>
                <p className="text-off/60 mt-2 text-sm leading-relaxed">
                  Sign in to track your complaints and receive safety alerts.
                </p>
              </div>

              {consumerMode === "register" && (
                <F id="c-name" label="Full name" type="text" ph="Jane Doe" v={name} set={setName} ac="name" minLength={2} />
              )}

              <F id="c-em" label="Email address" type="email" ph="jane@example.com" v={em} set={setEm} ac="username" />
              <F
                id="c-pw"
                label="Password"
                type={showPw ? "text" : "password"}
                ph="••••••••"
                v={pw}
                set={setPw}
                hint={consumerMode === "register" ? "At least 8 characters" : undefined}
                minLength={consumerMode === "register" ? 8 : 1}
                ac={consumerMode === "register" ? "new-password" : "current-password"}
                right={
                  <button
                    type="button"
                    onClick={() => setShowPw(s => !s)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="absolute right-0 bottom-2 text-off/60 hover:text-cream p-1 transition-colors"
                  >
                    {showPw ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                }
              />

              {err && <p role="alert" className="text-sm text-[#F2B8B5]">{err}</p>}

              <CTAButton type="submit">
                {busy
                  ? consumerMode === "register"
                    ? "Creating account…"
                    : "Signing in…"
                  : consumerMode === "register"
                  ? "Create Account"
                  : "Sign In"}
              </CTAButton>

              <div className="text-center pt-2">
                {consumerMode === "register" ? (
                  <p className="text-xs text-off/70">
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setConsumerMode("login");
                        setErr(null);
                      }}
                      className="text-cream underline font-medium hover:text-white"
                    >
                      Sign in
                    </button>
                  </p>
                ) : (
                  <p className="text-xs text-off/70">
                    New here?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setConsumerMode("register");
                        setErr(null);
                      }}
                      className="text-cream underline font-medium hover:text-white"
                    >
                      Create an account
                    </button>
                  </p>
                )}
              </div>
            </form>
          ) : (
            <form onSubmit={submitStaff} className="space-y-6">
              <div>
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Sign in</h1>
                <p className="text-off/60 mt-2 text-sm leading-relaxed">
                  For laboratory staff, FSSAI reviewers, administrators and data providers.
                </p>
              </div>

              <F id="em" label="Work email" type="email" ph="you@agency.gov / you@lab.org" v={em} set={setEm} ac="username" />
              <F
                id="pw"
                label="Password"
                type={showPw ? "text" : "password"}
                ph="••••••••"
                v={pw}
                set={setPw}
                ac="current-password"
                right={
                  <button
                    type="button"
                    onClick={() => setShowPw(s => !s)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="absolute right-0 bottom-2 text-off/60 hover:text-cream p-1 transition-colors"
                  >
                    {showPw ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                }
              />

              {err && <p role="alert" className="text-sm text-[#F2B8B5]">{err}</p>}

              <CTAButton type="submit">{busy ? "Signing in…" : "Continue"}</CTAButton>

              {meta?.demoData && (
                <p className="text-xs text-off/55 leading-relaxed">
                  Demonstration accounts (admin@, reviewer@, lab.nashik@, lab.pune@, provider@ tracex.demo) exist when seeded. The password is in the server configuration.
                </p>
              )}
            </form>
          )}
        </div>

        <div className="text-xs text-off/40 pt-4">
          traceX food safety & traceability network
        </div>
      </div>

      <div className="hidden lg:block relative">
        <Scene kind="farm" className="absolute inset-0 w-full h-full opacity-90" label="Farmland at dawn" />
      </div>
    </div>
  );
}
