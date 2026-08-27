import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';

export default [
    // Output 1: Root directory (so loading C:\Users\ad999\Downloads\UpForge directly in Chrome works)
    {
        input: 'offscreen.js',
        output: {
            file: 'offscreen.bundle.js',
            format: 'es',
            inlineDynamicImports: true,
            sourcemap: false
        },
        plugins: [
            resolve({
                browser: true,
                preferBuiltins: false
            }),
            commonjs(),
            copy({
                targets: [
                    { src: 'node_modules/@jsquash/**/*.wasm', dest: '.' },
                    { src: 'node_modules/@jsquash/**/*.wasm', dest: 'wasm' }
                ]
            })
        ]
    },
    // Output 2: Standalone dist/ directory
    {
        input: 'offscreen.js',
        output: {
            file: 'dist/offscreen.bundle.js',
            format: 'es',
            inlineDynamicImports: true,
            sourcemap: false
        },
        plugins: [
            resolve({
                browser: true,
                preferBuiltins: false
            }),
            commonjs(),
            copy({
                targets: [
                    { src: 'manifest.json', dest: 'dist' },
                    { src: 'background.js', dest: 'dist' },
                    { src: 'content-script.js', dest: 'dist' },
                    { src: 'main-world.js', dest: 'dist' },
                    { src: 'offscreen.html', dest: 'dist' },
                    { src: 'popup.html', dest: 'dist' },
                    { src: 'popup.js', dest: 'dist' },
                    { src: 'node_modules/@jsquash/**/*.wasm', dest: 'dist' },
                    { src: 'node_modules/@jsquash/**/*.wasm', dest: 'dist/wasm' }
                ]
            })
        ]
    }
];
