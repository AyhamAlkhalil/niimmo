
import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import plugin from "tailwindcss/plugin";

/*
 * Markenpalette (26.10.2026). Verankert an den beiden Logofarben: Karmin #BE2637 (Ross, „Ni“)
 * und Anthrazit #201C1D („Immo“). Die übrigen Familien sind gedämpfte Begleiter, in OKLCH mit
 * gleichmäßigen Helligkeitsstufen berechnet.
 *
 * Im Anwendungscode stehen rund 1800 fest verdrahtete Tailwind-Farben (docs/architektur.md §5).
 * Statt jede Datei anzufassen, lenkt ZUORDNUNG die Standardfamilien auf diese Palette um: Aus
 * `text-green-600` wird Waldgrün, aus `bg-blue-50` ein warmes Marineblau-Weiß, aus Grau warmer
 * Stein. Die Bedeutung (grün = erledigt, rot = Fehler, gelb = offen) bleibt erhalten.
 * Neuer Code nutzt trotzdem die Rollen-Tokens.
 */
const PALETTE = {
	neutral: { 50: '#fcfaf8', 100: '#f6f4f1', 200: '#eae6e3', 300: '#d8d4d0', 400: '#a7a19d', 500: '#726c69', 600: '#5b5452', 700: '#463f3f', 800: '#2e2828', 900: '#201c1d', 950: '#0d0a0a' },
	crimson: { 50: '#fff2f2', 100: '#fee4e2', 200: '#ffccc9', 300: '#fea6a5', 400: '#f37276', 500: '#e04653', 600: '#be2637', 700: '#a2042b', 800: '#810322', 900: '#68021c', 950: '#40010e' },
	rosewood: { 50: '#fcf3f6', 100: '#f6e7ec', 200: '#edd2db', 300: '#e2b2c3', 400: '#cd89a3', 500: '#b76988', 600: '#9b4e6e', 700: '#803b59', 800: '#672d46', 900: '#522337', 950: '#331020' },
	plum: { 50: '#f9f4f9', 100: '#f0e8f1', 200: '#e4d4e4', 300: '#d3b7d4', 400: '#b891ba', 500: '#a073a2', 600: '#855888', 700: '#6d456f', 800: '#573558', 900: '#452a47', 950: '#2a152b' },
	forest: { 50: '#f1f8f4', 100: '#e4eee7', 200: '#cce0d3', 300: '#a7ccb5', 400: '#78af8e', 500: '#55956e', 600: '#387b54', 700: '#276442', 800: '#1c4f32', 900: '#153f27', 950: '#052514' },
	sage: { 50: '#f2f7f5', 100: '#e4eeea', 200: '#ccdfd8', 300: '#a8cbbd', 400: '#79ad9a', 500: '#55937e', 600: '#387965', 700: '#276250', 800: '#1c4e3e', 900: '#153e31', 950: '#05241b' },
	petrol: { 50: '#f1f7f7', 100: '#e4edee', 200: '#ccdedf', 300: '#a8c9cb', 400: '#79abad', 500: '#549194', 600: '#37777a', 700: '#266063', 800: '#1b4c4e', 900: '#143c3e', 950: '#042325' },
	olive: { 50: '#f4f7f1', 100: '#e9ede3', 200: '#d6ddcb', 300: '#bac7a7', 400: '#96a878', 500: '#7a8e56', 600: '#60743b', 700: '#4c5d2a', 800: '#3b4a1f', 900: '#2f3a17', 950: '#192207' },
	navy: { 50: '#f2f6fb', 100: '#e5ecf5', 200: '#cfdbec', 300: '#adc4e2', 400: '#83a2ce', 500: '#6486b9', 600: '#4b6c9f', 700: '#3a5684', 800: '#2d436a', 900: '#243555', 950: '#121e36' },
	steel: { 50: '#f2f6f9', 100: '#e5ecf1', 200: '#cfdce4', 300: '#aec6d4', 400: '#83a6bb', 500: '#628ba3', 600: '#477189', 700: '#365b70', 800: '#284859', 900: '#1f3947', 950: '#0d212c' },
	iris: { 50: '#f4f5fb', 100: '#e9eaf4', 200: '#d6d9eb', 300: '#bbbfe0', 400: '#979ccc', 500: '#7b80b6', 600: '#62659c', 700: '#4d5080', 800: '#3c3f67', 900: '#303252', 950: '#1a1b34' },
	ochre: { 50: '#fcf7ef', 100: '#f6eedf', 200: '#eddec2', 300: '#e4c693', 400: '#d9a85b', 500: '#c88a28', 600: '#946003', 700: '#895202', 800: '#713f01', 900: '#5d2f00', 950: '#3b1a00' },
	gold: { 50: '#fbf9f1', 100: '#f6f2e4', 200: '#ece4ca', 300: '#e1d1a0', 400: '#d6bb71', 500: '#c6a348', 600: '#8c6a0d', 700: '#845f02', 800: '#6a4903', 900: '#583801', 950: '#382000' },
	terracotta: { 50: '#fef3ee', 100: '#fae7de', 200: '#f5d1c2', 300: '#f0b197', 400: '#e08561', 500: '#cb6239', 600: '#b04419', 700: '#92310a', 800: '#762406', 900: '#5f1c06', 950: '#3c0a00' },
};

const ZUORDNUNG = {
	gray: PALETTE.neutral,
	slate: PALETTE.neutral,
	zinc: PALETTE.neutral,
	neutral: PALETTE.neutral,
	stone: PALETTE.neutral,
	red: PALETTE.crimson,
	rose: PALETTE.crimson,
	pink: PALETTE.rosewood,
	fuchsia: PALETTE.plum,
	green: PALETTE.forest,
	emerald: PALETTE.sage,
	teal: PALETTE.petrol,
	lime: PALETTE.olive,
	blue: PALETTE.navy,
	sky: PALETTE.steel,
	cyan: PALETTE.petrol,
	indigo: PALETTE.iris,
	violet: PALETTE.iris,
	purple: PALETTE.plum,
	amber: PALETTE.ochre,
	yellow: PALETTE.gold,
	orange: PALETTE.terracotta,
};

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		// card und popover sind auch Namen eigener Schatten (shadow-card, shadow-popover). Als Schattenfarben
		// erzeugten sie eine zweite Regel, die den Schatten weiß färbte (QA 26.10.2026).
		boxShadowColor: ({ theme }) => {
			const { card: _karte, popover: _menue, ...farben } = theme('colors');
			return farben;
		},
		container: {
			center: true,
			padding: {
				DEFAULT: '1rem',
				sm: '1.5rem',
				lg: '2rem',
			},
			screens: {
				'2xl': '1400px'
			}
		},
		screens: {
			'xs': '475px',
			'sm': '640px',
			'md': '768px',
			'lg': '1024px',
			'xl': '1280px',
			'2xl': '1536px',
		},
			extend: {
				fontFamily: {
					'sans': ['InterVariable', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
					// Titel und große Beträge; nur ein Schnitt (400) -- fett wird nicht künstlich erzeugt (index.css)
					'serif': ['"Instrument Serif"', 'Georgia', 'serif'],
					'display': ['"Instrument Serif"', 'Georgia', 'serif'],
				},
				colors: {
					...PALETTE,
					...ZUORDNUNG,
					brand: {
						DEFAULT: 'hsl(var(--brand))',
						foreground: 'hsl(var(--brand-foreground))',
						soft: 'hsl(var(--brand-soft))',
					},
					canvas: 'hsl(var(--canvas))',
					border: 'hsl(var(--border))',
					input: 'hsl(var(--input))',
					ring: 'hsl(var(--ring))',
					background: 'hsl(var(--background))',
					foreground: 'hsl(var(--foreground))',
					primary: {
						DEFAULT: 'hsl(var(--primary))',
						foreground: 'hsl(var(--primary-foreground))'
					},
					secondary: {
						DEFAULT: 'hsl(var(--secondary))',
						foreground: 'hsl(var(--secondary-foreground))'
					},
					destructive: {
						DEFAULT: 'hsl(var(--destructive))',
						foreground: 'hsl(var(--destructive-foreground))'
					},
					success: {
						DEFAULT: 'hsl(var(--success))',
						foreground: 'hsl(var(--success-foreground))'
					},
					warning: {
						DEFAULT: 'hsl(var(--warning))',
						foreground: 'hsl(var(--warning-foreground))'
					},
					muted: {
						DEFAULT: 'hsl(var(--muted))',
						foreground: 'hsl(var(--muted-foreground))'
					},
					accent: {
						DEFAULT: 'hsl(var(--accent))',
						foreground: 'hsl(var(--accent-foreground))'
					},
					popover: {
						DEFAULT: 'hsl(var(--popover))',
						foreground: 'hsl(var(--popover-foreground))'
					},
					card: {
						DEFAULT: 'hsl(var(--card))',
						foreground: 'hsl(var(--card-foreground))'
					},
					sidebar: {
						DEFAULT: 'hsl(var(--sidebar-background))',
						foreground: 'hsl(var(--sidebar-foreground))',
						primary: 'hsl(var(--sidebar-primary))',
						'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
						accent: 'hsl(var(--sidebar-accent))',
						'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
						border: 'hsl(var(--sidebar-border))',
						ring: 'hsl(var(--sidebar-ring))'
					}
				},
				borderRadius: {
					lg: 'var(--radius)',
					md: 'calc(var(--radius) - 2px)',
					sm: 'calc(var(--radius) - 4px)'
				},
				// Weiche, mehrlagige Schatten mit warmem Anthrazit statt reinem Schwarz
				boxShadow: {
					sm: '0 1px 2px 0 rgb(32 28 29 / 0.05)',
					DEFAULT: '0 1px 2px 0 rgb(32 28 29 / 0.04), 0 2px 6px -1px rgb(32 28 29 / 0.06)',
					md: '0 1px 2px 0 rgb(32 28 29 / 0.04), 0 6px 16px -4px rgb(32 28 29 / 0.09)',
					lg: '0 2px 4px -1px rgb(32 28 29 / 0.04), 0 14px 32px -8px rgb(32 28 29 / 0.13)',
					xl: '0 4px 8px -2px rgb(32 28 29 / 0.05), 0 24px 48px -12px rgb(32 28 29 / 0.18)',
					'2xl': '0 8px 16px -4px rgb(32 28 29 / 0.06), 0 36px 72px -18px rgb(32 28 29 / 0.24)',
					inner: 'inset 0 1px 2px 0 rgb(32 28 29 / 0.06)',
					card: '0 0 0 1px rgb(32 28 29 / 0.02), 0 1px 2px 0 rgb(32 28 29 / 0.04), 0 4px 14px -6px rgb(32 28 29 / 0.08)',
					'card-hover': '0 0 0 1px rgb(32 28 29 / 0.03), 0 2px 4px -1px rgb(32 28 29 / 0.05), 0 18px 36px -12px rgb(32 28 29 / 0.16)',
					popover: '0 0 0 1px rgb(32 28 29 / 0.04), 0 4px 10px -2px rgb(32 28 29 / 0.08), 0 18px 40px -10px rgb(32 28 29 / 0.18)',
					dialog: '0 0 0 1px rgb(32 28 29 / 0.05), 0 8px 20px -6px rgb(32 28 29 / 0.12), 0 40px 90px -24px rgb(32 28 29 / 0.38)',
					knopf: 'inset 0 1px 0 0 rgb(255 255 255 / 0.10), 0 1px 2px 0 rgb(32 28 29 / 0.24), 0 2px 6px -2px rgb(32 28 29 / 0.22)',
					feld: 'inset 0 1px 1px 0 rgb(32 28 29 / 0.035)',
				},
				transitionTimingFunction: {
					sanft: 'cubic-bezier(0.22, 1, 0.36, 1)',
				},
				ringColor: {
					DEFAULT: 'hsl(var(--ring))',
				},
				keyframes: {
					'accordion-down': {
						from: {
							height: '0'
						},
						to: {
							height: 'var(--radix-accordion-content-height)'
						}
					},
					'accordion-up': {
						from: {
							height: 'var(--radix-accordion-content-height)'
						},
						to: {
							height: '0'
						}
					},
					/* Collapsible animations using the correct Radix CSS variables */
					'collapsible-down': {
						from: {
							height: '0'
						},
						to: {
							height: 'var(--radix-collapsible-content-height)'
						}
					},
					'collapsible-up': {
						from: {
							height: 'var(--radix-collapsible-content-height)'
						},
						to: {
							height: '0'
						}
					},
					'fade-in': {
						'0%': {
							opacity: '0',
							transform: 'translateY(10px)'
						},
						'100%': {
							opacity: '1',
							transform: 'translateY(0)'
						}
					},
					'fade-out': {
						'0%': {
							opacity: '1',
							transform: 'translateY(0)'
						},
						'100%': {
							opacity: '0',
							transform: 'translateY(10px)'
						}
					},
					'scale-in': {
						'0%': {
							transform: 'scale(0.95)',
							opacity: '0'
						},
						'100%': {
							transform: 'scale(1)',
							opacity: '1'
						}
					},
					'scale-out': {
						from: { 
							transform: 'scale(1)', 
							opacity: '1' 
						},
						to: { 
							transform: 'scale(0.95)', 
							opacity: '0' 
						}
					},
					'slide-in-right': {
						'0%': { 
							transform: 'translateX(100%)' 
						},
						'100%': { 
							transform: 'translateX(0)' 
						}
					},
					'slide-out-right': {
						'0%': { 
							transform: 'translateX(0)' 
						},
						'100%': { 
							transform: 'translateX(100%)' 
						}
					},
					'gradient-shift': {
						'0%, 100%': {
							'background-position': '0% 50%'
						},
						'50%': {
							'background-position': '100% 50%'
						}
					},
					'float': {
						'0%, 100%': {
							transform: 'translateY(0px)'
						},
						'50%': {
							transform: 'translateY(-6px)'
						}
					},
					'pulse-glow': {
						'0%, 100%': {
							boxShadow: '0 0 20px rgba(190, 38, 55, 0.18)'
						},
						'50%': {
							boxShadow: '0 0 40px rgba(190, 38, 55, 0.32)'
						}
					},
					'search-highlight': {
						'0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(190, 38, 55, 0.55)' },
						'25%': { transform: 'scale(1.05)', boxShadow: '0 0 30px 10px rgba(190, 38, 55, 0.25)' },
						'50%': { transform: 'scale(1.02)', boxShadow: '0 0 40px 15px rgba(190, 38, 55, 0.32)' },
						'75%': { transform: 'scale(1.05)', boxShadow: '0 0 30px 10px rgba(190, 38, 55, 0.25)' },
						'100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(190, 38, 55, 0.55)' }
					},
					'contract-found': {
						'0%': { borderColor: 'rgb(190 38 55)', backgroundColor: 'rgb(255 242 242)' },
						'50%': { borderColor: 'rgb(162 4 43)', backgroundColor: 'rgb(254 228 226)' },
						'100%': { borderColor: 'rgb(190 38 55)', backgroundColor: 'rgb(255 242 242)' }
					},
					'bounce-in': {
						'0%': { transform: 'scale(0) translateY(-20px)', opacity: '0' },
						'50%': { transform: 'scale(1.2) translateY(-10px)', opacity: '0.8' },
						'100%': { transform: 'scale(1) translateY(0)', opacity: '1' }
					},
					'pulse-once': {
						'0%': { boxShadow: '0 0 0 0 rgba(190, 38, 55, 0.55)' },
						'30%': { boxShadow: '0 0 0 8px rgba(190, 38, 55, 0.25)' },
						'60%': { boxShadow: '0 0 0 4px rgba(190, 38, 55, 0.4)' },
						'100%': { boxShadow: '0 0 0 0 rgba(190, 38, 55, 0)' }
					}
				},
				animation: {
					'accordion-down': 'accordion-down 0.2s ease-out',
					'accordion-up': 'accordion-up 0.2s ease-out',
					/* Collapsible animation names */
					'collapsible-down': 'collapsible-down 0.2s ease-out',
					'collapsible-up': 'collapsible-up 0.2s ease-out',
					'fade-in': 'fade-in 0.3s ease-out',
					'fade-out': 'fade-out 0.3s ease-out',
					'scale-in': 'scale-in 0.2s ease-out',
					'scale-out': 'scale-out 0.2s ease-out',
					'slide-in-right': 'slide-in-right 0.3s ease-out',
					'slide-out-right': 'slide-out-right 0.3s ease-out',
					'gradient-shift': 'gradient-shift 8s ease-in-out infinite',
					'float': 'float 3s ease-in-out infinite',
					'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
					'search-highlight': 'search-highlight 2s ease-in-out 2',
					'contract-found': 'contract-found 1s ease-in-out 3',
					'bounce-in': 'bounce-in 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
					'pulse-once': 'pulse-once 2s ease-out 1',
				},
				backgroundSize: {
					'300%': '300%',
				}
			}
		},
		plugins: [
			tailwindcssAnimate,
			// Handy quer (iPhone quer ~390 px hoch, Übergabe 22.10.2026). Als Variante, nicht
			// als Screen: ein `raw`-Screen schaltet alle max-*/min-*-Varianten still ab.
			// Achtung: Plugin-Varianten stehen im CSS vor sm:/md:/lg:/dark:/supports-*. Gegen
			// diese gewinnt quer: nur gestapelt, z. B. quer:supports-[…]:h-… statt quer:h-….
			// Das Seitenverhältnis hält Hochformat mit verkleinerndem Tastatur-Viewport heraus.
			plugin(({ addVariant }) => {
				addVariant('quer', '@media (orientation: landscape) and (max-height: 500px) and (min-aspect-ratio: 3/2)');
			}),
		],
} satisfies Config;
