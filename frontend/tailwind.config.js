/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        // --- RLD Technologies brand -------------------------------------
        // Same technique the RLD client portal uses: rather than rewrite ~1,530
        // utility usages across 59 files, the families this app was built on are
        // remapped onto the RLD palette. `amber-*` was the construction accent
        // and becomes RLD teal; `slate-*` becomes RLD's teal-tinted neutrals.
        // Brand anchors: 600 #0DA6B8 primary, 700 #0A8B9C hover,
        // 400 #34CFD6 aqua, 900 #0A2E39 deep, 100 #ECF3F5 canvas.
        rld: {
          teal: '#0DA6B8', tealDark: '#0A8B9C', aqua: '#34CFD6',
          sky: '#1C9BE0', azure: '#2E86DE', deep: '#0A2E39',
          ink: '#10212A', canvas: '#ECF3F5',
        },
        // accent family (was amber) => RLD teal-cyan
        amber: {
          50: '#EAFBFD', 100: '#D2F4F7', 200: '#9FE6EC', 300: '#6BD8E1',
          400: '#34CFD6', 500: '#0DA6B8', 600: '#0A8B9C', 700: '#0A6E7C',
          800: '#0A5460', 900: '#0A2E39', 950: '#06202A',
        },
        blue: {
          50: '#EAFBFD', 100: '#D2F4F7', 200: '#9FE6EC', 300: '#6BD8E1',
          400: '#34CFD6', 500: '#12B8C9', 600: '#0DA6B8', 700: '#0A8B9C',
          800: '#0A6E7C', 900: '#0A2E39', 950: '#06202A',
        },
        // neutrals => RLD teal-tinted greys
        slate: {
          50: '#F8FCFC', 100: '#ECF3F5', 200: '#DFEAEC', 300: '#C6D8DC',
          400: '#82929C', 500: '#6B7C86', 600: '#4B5C66', 700: '#35454E',
          800: '#1F323B', 900: '#10212A', 950: '#081920',
        },
        // semantic families, aligned to the brand
        emerald: {
          50: '#E1F6EC', 100: '#C4EDD9', 200: '#A5E3C6', 300: '#6FD3A6',
          400: '#35C489', 500: '#13B26C', 600: '#0E7C55', 700: '#0B6344',
          800: '#084B33', 900: '#06381F', 950: '#042616',
        },
        red: {
          50: '#FDECEC', 100: '#FAD5D4', 200: '#F5B8B6', 300: '#EF9694',
          400: '#EA6E6F', 500: '#E5484D', 600: '#C6362F', 700: '#A32B25',
          800: '#7A211C', 900: '#5C1915', 950: '#3D100E',
        },
        sky: {
          50: '#E8F5FD', 100: '#CBE9FA', 200: '#97D3F5', 300: '#63BDEF',
          400: '#3FAEE9', 500: '#1C9BE0', 600: '#167CB4', 700: '#115E88',
          800: '#0C4160', 900: '#082B3F', 950: '#051C29',
        },
        violet: {
          50: '#EAF2FC', 100: '#D0E2F8', 200: '#A3C6F1', 300: '#75A9E9',
          400: '#4E96E4', 500: '#2E86DE', 600: '#256BB2', 700: '#1C5086',
          800: '#133659', 900: '#0D243C', 950: '#081826',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        }
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
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: [require("tailwindcss-animate")],
};
