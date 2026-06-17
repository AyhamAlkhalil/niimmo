
import type { Config } from "tailwindcss";

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
					'sans': ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
					'serif': ['Playfair Display', 'Georgia', 'serif'],
					'display': ['Playfair Display', 'Georgia', 'serif'],
				},
				colors: {
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
							boxShadow: '0 0 20px rgba(239, 68, 68, 0.2)'
						},
						'50%': {
							boxShadow: '0 0 40px rgba(239, 68, 68, 0.4)'
						}
					},
					'search-highlight': {
						'0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.7)' },
						'25%': { transform: 'scale(1.05)', boxShadow: '0 0 30px 10px rgba(239, 68, 68, 0.3)' },
						'50%': { transform: 'scale(1.02)', boxShadow: '0 0 40px 15px rgba(239, 68, 68, 0.4)' },
						'75%': { transform: 'scale(1.05)', boxShadow: '0 0 30px 10px rgba(239, 68, 68, 0.3)' },
						'100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.7)' }
					},
					'contract-found': {
						'0%': { borderColor: 'rgb(239 68 68)', backgroundColor: 'rgb(254 242 242)' },
						'50%': { borderColor: 'rgb(220 38 38)', backgroundColor: 'rgb(254 226 226)' },
						'100%': { borderColor: 'rgb(239 68 68)', backgroundColor: 'rgb(254 242 242)' }
					},
					'bounce-in': {
						'0%': { transform: 'scale(0) translateY(-20px)', opacity: '0' },
						'50%': { transform: 'scale(1.2) translateY(-10px)', opacity: '0.8' },
						'100%': { transform: 'scale(1) translateY(0)', opacity: '1' }
					},
					'pulse-once': {
						'0%': { boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.7)' },
						'30%': { boxShadow: '0 0 0 8px rgba(239, 68, 68, 0.3)' },
						'60%': { boxShadow: '0 0 0 4px rgba(239, 68, 68, 0.5)' },
						'100%': { boxShadow: '0 0 0 0 rgba(239, 68, 68, 0)' }
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
		plugins: [require("tailwindcss-animate")],
} satisfies Config;
