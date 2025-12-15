import { areJidsSameUser } from '@whiskeysockets/baileys';
import { BAD_WORDS_EN, BAD_WORDS_UR } from './config.js';

const LINK_REGEX = new RegExp(
  /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(\b[a-zA-Z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?\b)/gi,
);
const ABUSE_REGEX = new RegExp(
  `\\b(${[...BAD_WORDS_EN, ...BAD_WORDS_UR].join('|')})\\b`,
  'g',
);

// State management objects
const linkWarningCounts = {}; // For link warnings
const spamTracker = {}; // For spam detection

// Helper function to count words
const countWords = (str) => str.trim().split(/\s+/).length;

// Main function to handle incoming messages
export async function handleMessage(sock, message) {
  if (!message || !message.key || !message.key.remoteJid) return;

  const remoteJid = message.key.remoteJid;
  if (!remoteJid.endsWith('@g.us')) return;

  let groupMetadata;
  try {
    groupMetadata = await sock.groupMetadata(remoteJid);
  } catch (e) {
    return;
  }

  const participants = groupMetadata.participants;
  const sender = message.key.participant || message.key.remoteJid;
  if (!sender) return;

  const senderInfo = participants.find((p) => areJidsSameUser(p.id, sender));
  const isSenderAdmin =
    senderInfo &&
    (senderInfo.admin === 'admin' || senderInfo.admin === 'superadmin');
  if (isSenderAdmin) return;

  const messageContent =
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    '';
  const senderName = message.pushName || 'Unknown User';

  // --- 1. Spam Detection Logic ---
  if (messageContent && countWords(messageContent) > 30) {
    if (!spamTracker[remoteJid]) spamTracker[remoteJid] = {};

    const userSpamInfo = spamTracker[remoteJid][sender];

    if (userSpamInfo && userSpamInfo.message === messageContent) {
      // Same long message repeated
      userSpamInfo.count++;
      const count = userSpamInfo.count;

      if (count >= 4) {
        const finalWarning = `*⚠️ Spam Warning ⚠️*\n\nHello ${senderName}, you have sent the same message 4 times.\n*Action:* You are being removed from the group.`;

        await sock.sendMessage(remoteJid, { text: finalWarning });
        try {
          await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove');
          console.log(`[REMOVED] User ${senderName} (${sender}) for spamming.`);
          delete spamTracker[remoteJid][sender]; // Reset tracker after removal
        } catch (e) {
          console.error('Failed to remove user for spam:', e);
        }
        return; // Stop further processing
      } else if (count === 3) {
        const warningText = `*⚠️ Spam Warning ⚠️*\n\nHello ${senderName}, you are spamming. You have sent this message 3 times. If you send it again, you will be removed.`;

        await sock.sendMessage(remoteJid, { text: warningText });
        return; // Stop further processing
      }
    } else {
      // New long message, start tracking it
      spamTracker[remoteJid][sender] = { message: messageContent, count: 1 };
    }
  } else if (spamTracker[remoteJid] && spamTracker[remoteJid][sender]) {
    // If user sends a different (or short) message, reset their spam tracker
    delete spamTracker[remoteJid][sender];
  }

  // --- 2. Link Warning System ---
  if (LINK_REGEX.test(messageContent)) {
    if (!linkWarningCounts[remoteJid]) linkWarningCounts[remoteJid] = {};
    if (!linkWarningCounts[remoteJid][sender])
      linkWarningCounts[remoteJid][sender] = 0;

    linkWarningCounts[remoteJid][sender]++;
    const count = linkWarningCounts[remoteJid][sender];

    await sock.sendMessage(remoteJid, { delete: message.key });

    if (count >= 3) {
      const finalWarning = `*⚠️ Final Link Warning (${count}/3) ⚠️*\n\nHello ${senderName}, you have sent links 3 times.\n*Action:* You are being removed from the group.`;

      await sock.sendMessage(remoteJid, { text: finalWarning });
      try {
        await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove');
        delete linkWarningCounts[remoteJid][sender];
      } catch (e) {
        console.error('Failed to remove user for links:', e);
      }
    } else {
      const remaining = 3 - count;
      const warningText = `*⚠️ Link Warning (${count}/3) ⚠️*\n\nHello ${senderName}, sending links in this group is not allowed.\n*Remaining Warnings:* ${remaining}`;

      await sock.sendMessage(remoteJid, { text: warningText });
    }
    return;
  }

  // --- 3. Bad Word Deletion ---
  if (ABUSE_REGEX.test(messageContent.toLowerCase())) {
    try {
      await sock.sendMessage(remoteJid, { delete: message.key });
      const warningText = `*⚠️ Warning ⚠️*\n\nHello ${senderName}, your message has been removed.\n*Reason:* Verbal Abuse.`;
      await sock.sendMessage(remoteJid, { text: warningText });
    } catch (e) {}
  }
}
