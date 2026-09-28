/**
 * Judge-facing demo screen — a full product landing page in ~45 lines of Claro.
 * Uses only built-in elements (component instances currently warn on
 * "unknown-type"), so the Problems panel stays 0/0 during a live demo.
 * Loaded by the Judging Tour ("See" step) and the Command Palette.
 */

/** Prompt the tour pre-fills in BHASM for the live "Edit" step. */
export const DEMO_EDIT_PROMPT = "Make the hero title bigger and accent-colored, then add a badge under it";

export const DEMO_SOURCE = `# A whole product page in Claro — type it, preview it, iterate it.
page Aurora {
    navbar {
        justify: between
        heading "Aurora" {
            size: 20
            weight: semibold
        }
        button "Docs" {
            variant: ghost
        }
        button "Sign in" {
            variant: ghost
        }
        button "Get Aurora" {
            variant: primary
        }
    }

    section hero {
        justify: center
        align: center
        gap: 12
        animation: fade-in
        effect: aurora
        badge "Edge AI · local-first" {
            variant: accent
        }
        heading "Ship the screen you can already see" {
            align: center
            size: 56
            weight: semibold
        }
        text "Claro is a reversible, AI-native UI language. Write it, preview it, undo it — all on your device." {
            align: center
            color: rgba(200, 200, 208, 1)
            size: 18
        }
        row {
            justify: center
            gap: 12
            button "Start building" {
                variant: primary
                effect: glow
            }
            button "Watch the 90s demo" {
                variant: outline
            }
        }
    }

    grid stats {
        columns: [1fr 1fr 1fr]
        gap: 16
        card {
            badge "REVERSIBLE" {
                variant: success
            }
            text "Every edit is a PatchOp. Undo any AI change, in any order." {
                size: 14
            }
        }
        card {
            badge "EDGE-GATED" {
                variant: accent
            }
            text "A local embedding prior answers most decisions — the 3B model sleeps." {
                size: 14
            }
        }
        card {
            badge "REAL ARTIFACTS" {
                variant: warn
            }
            text "Export a single-file web app or Kotlin Compose — no lock-in." {
                size: 14
            }
        }
    }

    section pricing {
        heading "Simple, local, yours" {
            align: center
            size: 32
        }
        grid tiers {
            columns: [1fr 1fr 1fr]
            gap: 16
            card {
                heading "Hobby" {
                    size: 18
                }
                text "Free · local model · unlimited undo"
                button "Get started" {
                    variant: ghost
                }
            }
            card {
                heading "Pro" {
                    size: 18
                }
                text "$0/mo · your machine · no cloud"
                button "Choose Pro" {
                    variant: primary
                    effect: glow
                }
            }
            card {
                heading "Team" {
                    size: 18
                }
                text "Bring your own Ollama pool"
                button "Talk to us" {
                    variant: outline
                }
            }
        }
    }

    section newsletter {
        form {
            gap: 12
            text "Join the waitlist for Android export" {
                size: 16
                weight: medium
            }
            row {
                gap: 8
                input {
                    label: "Email"
                    placeholder: "you@device.dev"
                    type: email
                }
                button "Subscribe" {
                    variant: primary
                }
            }
        }
    }

    divider {
        thickness: 1
    }

    section footer {
        align: center
        justify: center
    }
}
`;