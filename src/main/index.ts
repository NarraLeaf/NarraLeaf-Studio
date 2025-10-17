import { app } from 'electron';

console.log('Hello, World!');

app.whenReady().then(() => {
    console.log('App is ready');
    app.quit();
});