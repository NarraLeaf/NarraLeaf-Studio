/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './src/renderer/**/*.{ts,tsx,js,jsx,html}',
        './project/assets/**/*.ejs',
    ],
    theme: {
        extend: {
            fontWeight: {
                normal: '300',
            }
        }
    },
    plugins: [],
}