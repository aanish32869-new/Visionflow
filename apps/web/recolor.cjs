const fs = require('fs');
const path = require('path');

function replaceInFiles(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            replaceInFiles(filePath);
        } else if (filePath.endsWith('.jsx') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
            let content = fs.readFileSync(filePath, 'utf8');
            let original = content;
            // primary
            content = content.replace(/#6B21A8/gi, '#C41E2A');
            // dark hover
            content = content.replace(/#581c87/gi, '#a5151f');
            // light background
            content = content.replace(/#F3E8FF/gi, '#fbe2e2');
            // old purple border
            content = content.replace(/#a78bfa/gi, '#e56464');
            
            if (content !== original) {
                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`Updated ${filePath}`);
            }
        }
    }
}

replaceInFiles('./src');
