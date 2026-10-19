import Constants from 'expo-constants';
import { appConfigOf } from './app-config';

/** This build's app and server (app.config.ts → `extra`). */
export const APP = appConfigOf(Constants.expoConfig?.extra);
