import {execFileSync} from 'node:child_process';
if(process.platform==='darwin')execFileSync('xcrun',['swiftc','assets/scanner/Scanner.swift','-o','assets/scanner/gcp-scanner','-framework','ImageCaptureCore','-framework','AppKit'],{stdio:'inherit'});
