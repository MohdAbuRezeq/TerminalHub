#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

const projectDir = path.join(__dirname, '..');
execSync('npm start', { cwd: projectDir, stdio: 'inherit' });
