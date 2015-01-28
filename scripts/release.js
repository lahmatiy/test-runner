#!/usr/bin/env node

var exec = require('child_process').exec;
var fs = require('fs');
var pathUtils = require('path');
var versionRx = /("version"\s*:\s*")[^"]+"/i;
var TMP_FOLDER = 'release.tmp';
var RES_FOLDER = pathUtils.join(TMP_FOLDER, 'res');
var DEBUG = false;

function replaceInFile(filename, rx, value){
  fs.writeFileSync(
    filename,
    fs.readFileSync(filename, 'utf-8').replace(rx, value),
    'utf-8'
  );
}

function run(command, args, fn){
  if (DEBUG) console.log('[DEBUG] ' + command + ' ' + args.join(' ') + '\n');

  require('child_process').spawn(
    command,
    args,
    { stdio: 'inherit' }
  ).on('exit', function(code){
    if (code)
      return console.log('\nCommand failed, exit code:', code);

    if (DEBUG) console.log('\n[DEBUG] DONE\n');

    if (typeof fn == 'function')
      fn();
  });
}

function rm(path){
  if (!fs.existsSync(path))
    return;

  var stat = fs.statSync(path);
  if (stat.isDirectory())
  {
    fs.readdirSync(path).forEach(function(fn){
      rm(pathUtils.join(path, fn));
    });
    fs.rmdirSync(path);
  }
  else
  {
    fs.unlinkSync(path);
  }
}

var version = process.argv[2];

if (!version)
{
  console.error('Version should be specified as command argument');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+\S*$/.test(version))
{
  console.error('Version should correct semver (i.e. 1.2.3)');
  process.exit(1);
}

// delete temp folder
rm(TMP_FOLDER);

// main task
console.log('# Clone release repo to temp folder');
run('git', ['clone', '--depth', '1', 'https://github.com/basisjs/test-runner-build.git', TMP_FOLDER], function(){
  console.log('# Delete res folder');
  rm(RES_FOLDER);

  console.log('# Build application');
  run('basis', DEBUG
    ? ['build', '-o', TMP_FOLDER]
    : ['build', '-p', '-o', TMP_FOLDER],
    function(){
    console.log('# Set version in package.json & bower.json');
    replaceInFile(TMP_FOLDER + '/package.json', versionRx, '$1' + version + '"');
    replaceInFile(TMP_FOLDER + '/bower.json', versionRx, '$1' + version + '"');

    process.chdir(TMP_FOLDER);
    console.log('# Commit changes');
    run('git', ['add', '.'], function(){
      run('git', ['commit', '-am', 'v' + version], function(){

        console.log('# Add tag v' + version);
        run('git', ['tag', '-a', 'v' + version, '-m', 'version ' + version], function(){
          if (DEBUG)
          {
            console.log('The last thing left is `git push`. Skip it as debug.');
            return;
          }

          // publish
          console.log('# Push changes to repo');
          run('git', ['push'], function(){
            console.log('# Push tags to repo');
            run('git', ['push', '--tags'], function(){
              console.log('# Clean up');
              process.chdir('..');
              rm(TMP_FOLDER);

              console.log('\nDONE!');
            });
          });
        });
      });
    });
  });
});