import * as electron from 'electron/main';
console.log('electron keys:', Object.keys(electron));
for (const key of Object.keys(electron)) {
  console.log(key, ':', typeof electron[key]);
}