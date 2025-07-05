# AM2Z NPM Publication Guide

## Pre-Publication Checklist ✅

- [x] **Build System**: Working build with TypeScript declarations
- [x] **Package Structure**: Proper exports for main, core, and node modules  
- [x] **Dependencies**: All dependencies properly categorized
- [x] **License**: MIT license file created
- [x] **.npmignore**: Excludes source files, includes only dist/
- [x] **README**: Comprehensive documentation with examples
- [x] **CHANGELOG**: Detailed version history and migration guide
- [x] **Version**: Set to 2.0.0 for major release

## Package Structure

```
am2z@2.0.0
├── dist/
│   ├── index.js (767KB) - Main bundle
│   ├── index.d.ts - Main TypeScript declarations  
│   └── src/lib/ - Individual module declarations
├── LICENSE (MIT)
├── README.md (11.3KB)
├── package.json (2.8KB) 
└── CHANGELOG.md
```

## Publication Commands

### 1. **Dry Run** (Recommended First)
```bash
npm pack --dry-run
```
This shows exactly what will be published without actually publishing.

### 2. **Build & Verify**
```bash
bun run build
npm pack
```
Creates `am2z-2.0.0.tgz` for local testing.

### 3. **Test Installation**
```bash
# In a test project
npm install ./am2z-2.0.0.tgz
```

### 4. **Publish to NPM**
```bash
# Login to NPM (if not already logged in)
npm login

# Publish the package
npm publish

# Or for pre-release
npm publish --tag beta
```

## Package Information

- **Name**: `am2z`
- **Version**: `2.0.0`
- **Size**: 203.0 kB (compressed), 846.6 kB (unpacked)
- **Files**: 27 total files
- **Main Exports**:
  - `am2z` - Full framework
  - `am2z/core` - Core framework only  
  - `am2z/node` - Node.js distributed features

## Installation for Users

```bash
# Basic installation
npm install am2z

# With distributed features
npm install am2z bullmq ioredis zod

# With TypeScript support (included)
npm install am2z @types/node
```

## Post-Publication

### 1. **Verify Publication**
```bash
npm view am2z
npm info am2z versions --json
```

### 2. **Test Installation**
```bash
# Create test project
mkdir test-am2z && cd test-am2z
npm init -y
npm install am2z

# Test import
node -e "console.log(require('am2z'))"
```

### 3. **Update Documentation**
- Update GitHub README with NPM install instructions
- Create GitHub release with tag `v2.0.0`
- Update any external documentation

## Version Management

### Current Version Strategy
- **Major**: 2.x - Breaking changes (current)
- **Minor**: 2.x.x - New features, backward compatible
- **Patch**: 2.x.x - Bug fixes

### Next Release Process
```bash
# For patches
npm version patch

# For minor features  
npm version minor

# For breaking changes
npm version major

# Then publish
npm publish
```

## Troubleshooting

### Common Issues

1. **403 Forbidden**: Check NPM login and package name availability
2. **Package Size**: 203KB is reasonable for a framework
3. **Dependencies**: All peer dependencies documented

### Package Testing
```bash
# Test all exports work
node -e "
const am2z = require('am2z');
const core = require('am2z/core');  
const node = require('am2z/node');
console.log('All exports working!');
"
```

## Security Considerations

- [x] No secrets in package
- [x] No dev dependencies in production bundle
- [x] Source maps excluded from package
- [x] Only dist/ folder published

## Ready for Publication! 🚀

The package is fully prepared and ready for NPM publication. All files are properly configured, dependencies are correct, and the build system is working.

**Recommended next step**: Run `npm publish` to make AM2Z available on NPM!