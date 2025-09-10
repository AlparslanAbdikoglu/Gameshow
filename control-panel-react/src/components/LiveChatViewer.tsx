import React, { useState, useEffect, useRef, useCallback } from 'react';
import GlassPanel from './GlassPanel';
import styles from './KimbillionaireControlPanel.module.css';
import { API_BASE_URL, WS_BASE_URL } from '../config';

interface ChatMessage {
  id: string;
  username: string;
  text: string;
  platform: 'twitch' | 'youtube' | 'system';
  timestamp: number;
  isRoaryResponse?: boolean;
  badges?: string[];
  color?: string;
  isModerator?: boolean;
  isVip?: boolean;
  isAskAModResponse?: boolean;
  suggestedAnswer?: string;
}

interface LiveChatViewerProps {
  disabled?: boolean;
}

// Singleton WebSocket manager to ensure only one connection
let sharedWebSocket: WebSocket | null = null;
let messageHandlers: Set<(message: ChatMessage) => void> = new Set();
let connectionPromise: Promise<void> | null = null;
let instanceCounter = 0;

// Twitch Emote Definitions
const TWITCH_EMOTES: { [key: string]: string } = {
  // Original emotes from first list
  'k1m6aClipit': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c6a0b28a6a5548c8b64698444174173a/default/dark/2.0',
  'k1m6aChef': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_24c6bfc0497a4c96892cf3c3bc01fe48/default/dark/2.0',
  'k1m6aCo': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_5b17cf73d7d5417aa8f37b8bb9f6e0fe/default/dark/2.0',
  'k1m6aHappyJam': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1e21c9ad16cf4ffa8f8e73df44d4e58f/default/dark/2.0',
  'k1m6aHorse': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ef95fef0a0d74e6db614d4dac82b8f5f/default/dark/2.0',
  'k1m6aHotel': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f3e5e68ba91c4fb3beeaaa69ad14e51f/default/dark/2.0',
  'k1m6aLove': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_767294f4fbf14deaa65487efb5e11b55/default/dark/2.0',
  'k1m6aJam': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e849d7766e9e4293a881e75f8139552c/default/dark/2.0',
  'k1m6aLul': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_04f3c7fe0428460e855cbd6a62aa8b07/default/dark/2.0',
  'k1m6aBaby': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e36e16f7e6304e949de83f92e4e7d8bb/default/dark/2.0',
  'k1m6aLeech': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b40ba59b36084f7db37e88c0b4fce24f/default/dark/2.0',
  'k1m6aSteer': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_7f852081c9a14efe9bde161c4359a528/default/dark/2.0',
  'k1m6aKk': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_2e32b96c8e77461c857c0e90de1f9d4f/default/dark/2.0',
  'k1m6aTrain': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_4cf670d5fa8242ebab89a6ab5c616771/default/dark/2.0',
  'k1m6aDj': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_8cf31502415443788a03fe3aefc1a7af/default/dark/2.0',
  'k1m6aBlock': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_45bbf656cd1c42e3ab9d2bb614dc6b2e/default/dark/2.0',
  'k1m6aPalmtree': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a1dfffa070c6420d9b673b3b1f1f0acf/default/dark/2.0',
  'k1m6aPizza': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ab88a0dbf28c486d8e079e23e973e83f/default/dark/2.0',
  'k1m6aSunshine': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e1f21e4e7fea439a9b36f0ba02b0e7ee/default/dark/2.0',
  'k1m6aPsgjuice': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ea0ac815167448e7a1cafde20fe93427/default/dark/2.0',
  'k1m6aSmile': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3fea13ba7b5e455a93cc959dfb0e0c86/default/dark/2.0',
  'k1m6aGlizz': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b1a067c85b2349ffa1e1b6e39f8e4bc6/default/dark/2.0',
  'k1m6aChin': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_cae4cf9b3de842b995f5ba982f7bb370/default/dark/2.0',
  'k1m6aNoshot': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e06de7c832b0440b8f96ba067b9fbb96/default/dark/2.0',
  'k1m6aSalute': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b6e561b15bb1485683e3bdb862204b49/default/dark/3.0',
  'k1m6aShotty': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f30f82c8e6de4b2e92797ab59f2df36e/default/dark/2.0',
  'k1m6aMonkey': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d91f03c0cc35425db3cf7f8b83025595/default/dark/2.0',
  'k1m6aShiba': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_63c1e5f3b8ca4c72827297e6f03bb53e/default/dark/2.0',
  'k1m6aSpray': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1cf332c5e73b45e18d23f95c1c6cf2f5/default/dark/2.0',
  'k1m6aRice': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_78ae7cdf89814354a09a50be08d9ea22/default/dark/2.0',
  'k1m6aBowl': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f1322c73e93a4bb08897fb50802e0cd2/default/dark/2.0',
  'k1m6aWine': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1a0b4c33bb92417e855dc8cdb06d46da/default/dark/2.0',
  'k1m6aCheer': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d1ae4b977a2c40b5b6f8acef7fa17cd1/default/dark/2.0',
  'k1m6aChew': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b3a97a6dea0e415993b5b666e5f69e95/default/dark/2.0',
  'k1m6aDrop': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_83e1e1e0b09e46ed89802d98dc1c00ce/default/dark/2.0',
  'k1m6aGreenscreen': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_30dcf8de63fb4b9fb891bbaf95cca80a/default/dark/2.0',
  'k1m6aStupid': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_96c07f1a9c96426bbfdf1e1bc4f99c04/default/dark/2.0',
  'k1m6aLongbeach': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_9e012ced913a412a9cbfb973d8e5b3a7/default/dark/2.0',
  'k1m6aNotb': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_24a1a1d0b2f64b659ca09b6e88d09fb1/default/dark/2.0',
  'k1m6aMatcha': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3b26cf9fbe9f4bc58a860f7f5f616ef7/default/dark/2.0',
  'k1m6aLetcook': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dbe732bb16254bb7876caf1b6b1c14f1/default/dark/2.0',
  'k1m6aMuni': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f3c5f4f2bf9848b4851e5c7d30c10f76/default/dark/2.0',
  'k1m6aFb': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_97b2b18b37e9485099ad7c12a8fa47f5/default/dark/2.0',
  'k1m6aRamen': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1b2b93f1cf6543b495e969f51e6fda31/default/dark/2.0',
  'k1m6aSoju': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_7090e951f6a14bc5b7ef2e5ea37dc970/default/dark/2.0',
  'k1m6aIce': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ee70fe2c3e5948e09d973f4dd6c614f0/default/dark/2.0',
  'k1m6aEarl': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_2f2c957e3a2d4eb7849fc6e26fa2ec4b/default/dark/2.0',
  'k1m6aCoomer': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e088b65bb2cf472d9b4e6a52d616e6fa/default/dark/2.0',
  'k1m6aFunkycoomer': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_fd7ee96c00ef4063825f9b48eceeed66/default/dark/2.0',
  'k1m6aObo': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_4fefa69bb6db469097eeb8bb99987c2a/default/dark/2.0',
  'k1m6aOk': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d63f079b08ee4dffbc44e73dcff2b10f/default/dark/2.0',
  'k1m6aSnore': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f26e1f8b15ad49c7afd18c89abaab22f/default/dark/2.0',
  'k1m6aRun': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3b0ad39b67fa4c57ac7f4f87f2cc2b4f/default/dark/2.0',
  'k1m6aCake': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d7f0b4e5aa174fc3a19e646c4c8aa48f/default/dark/2.0',
  'k1m6aEgg': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e2a7e67a7e914c97a9bb646d8e7c62e3/default/dark/2.0',
  'k1m6aJj': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_7a9f670b0cf54b5c9cf6f7b5ad0a4f42/default/dark/2.0',
  'k1m6aFrog': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_fad59febe61647e099b1e81e1fdb8a8f/default/dark/2.0',
  'k1m6aHeart': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d088de4a03514f59a566f0ad97de0595/default/dark/2.0',
  'k1m6aChamp': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dca4c5f1b0b943c7849d5a85fb6c2dcc/default/dark/2.0',
  'k1m6aBoom': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_aff4b7cb58094f6fb95f95e2bdf3f7f8/default/dark/2.0',
  'k1m6aSick': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c4e3c7c67c2a495198ea9cc982e31dd7/default/dark/2.0',
  'k1m6aFr': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e1cf1c28f98d49c6bfba50c80ee82b5f/default/dark/2.0',
  'k1m6aFrr': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1e25e5c8eeb04e839d34c1b0ea58a6a5/default/dark/2.0',
  'k1m6aPink': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b0e35b17a63d4dd78ac1cf6d14f9cf5e/default/dark/2.0',
  'k1m6aReally': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_66f27cd5cf764bb2ad4e8d52bfa3c9ba/default/dark/2.0',
  'k1m6aStand': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_96f1e74bb7fc4d42ad842a9c0e7fb1e9/default/dark/2.0',
  'k1m6aShip': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a860feac7bff4e7587e6e8bb2b6aac68/default/dark/2.0',
  'k1m6aWoody': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_67feaf4b70224bc4adff7db8b893bf37/default/dark/2.0',
  'k1m6aGrunt': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ad69bb69b4174f6c888f067a4c3f96ef/default/dark/2.0',
  'k1m6aLime': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_0ddfd5c6f50b47b99fb3f014b6c0a41f/default/dark/2.0',
  'k1m6aClean': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d4dd3f37b6344c8ba72d1bb7a72fecef/default/dark/2.0',
  'k1m6aJumbotron': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e6a039c8cc3f4c39b0b26a84b5cb0eea/default/dark/2.0',
  'k1m6aOwl': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3f2a72e9f7b14e61a2e7b05a1e5177d0/default/dark/2.0',
  'k1m6aOat': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_5d853f94bfcd49779eee59f8cf66cc9f/default/dark/2.0',
  'k1m6aSpread': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3c4bb7febe9f494589ba91f4bf7fbe2b/default/dark/2.0',
  'k1m6aSwag': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b965f3e1e71243919b92e1b829dcaa2e/default/dark/2.0',
  'k1m6aUp': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_cd4c2f48e4ac4c96980bb0c4797b7ca7/default/dark/2.0',
  'k1m6aWack': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e55b5b0babb94e30a0e1819c1ba4b90d/default/dark/2.0',
  'k1m6aLb': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_cd088c039ad34f00a8f6c616b21c61f5/default/dark/2.0',
  
  // New emotes from the updated list
  'k1m6aCarried': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_68877ffd62914c0baf656683a56885e3/default/dark/2.0',
  'k1m6aBonk': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_6d4a3720c4ca4553a9f7d09ecc228d1c/default/dark/2.0',
  'k1m6aBlind': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_008fc17538c54d7baf69325b406d421b/default/dark/2.0',
  'k1m6aBlade': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d4688e604455438e990eda8bfe386621/default/dark/2.0',
  'k1m6aBan': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a09c3654c25f4a9194ac04951e867285/default/dark/2.0',
  'k1m6aAstronaut': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c261a2bf5aef4f20a05876f12acfde0b/default/dark/2.0',
  'k1m6a1010': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_8948832ab3834d34bd62ade32a697858/default/dark/2.0',
  'k1m6aCrab': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_5bcd86cb8351436c84a5a90927e91d2a/default/dark/2.0',
  'k1m6aCozy': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_10002a6ae9cc4f50a5ca94949ca4a096/default/dark/2.0',
  'k1m6aCopium': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_5eca88a8751f4a04b5882b70304e4053/default/dark/2.0',
  'k1m6aCool': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_19d1d2370d7e49d08926d9c40f1cf699/default/dark/2.0',
  'k1m6aConfused': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1d50d00f2a1444f4a4952f3aaf562ede/default/dark/2.0',
  'k1m6aCoffeesip': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_116a23cc11734b41b27f6f922b62f630/default/dark/2.0',
  'k1m6aCoffee': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_413469c842154f72853b651c6db8c0f4/default/dark/2.0',
  'k1m6aClown': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b289f3411b9b4ccc862385d4d20c26a0/default/dark/2.0',
  'k1m6aDerp': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_681daf912abc479980401475f6b9c082/default/dark/2.0',
  'k1m6aDevil': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a370f93b4f9744989b2ab2d357dd061c/default/dark/2.0',
  'k1m6aDoit': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f6971cbe0867419085814dd09ba3ee2f/default/dark/2.0',
  'k1m6aFacepalm': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_5db4850780504895ab219bdcd03339ab/default/dark/2.0',
  'k1m6aFail': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_0435ef9b206b459aae88657265db15a8/default/dark/2.0',
  'k1m6aFine': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e9eaecce2b094260b0f4b39bc95b70d0/default/dark/2.0',
  'k1m6aFlower': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_9440e8eae9e44659b39c3380007b05cd/default/dark/2.0',
  'k1m6aGasm': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_26ae96c88de64ecab0f5deab4643caff/default/dark/2.0',
  'k1m6aGasp': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_8ee142074d2f41429ffc803ff890a290/default/dark/2.0',
  'k1m6aGg': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_6d97ed643b5a4e19a7ce156a02dede7c/default/dark/2.0',
  'k1m6aGhost': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ec96872a82c34e32bf3d9729647ed717/default/dark/2.0',
  'k1m6aGift': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_b0b9ae66f2b74b6fbdab36669ab9a25e/default/dark/2.0',
  'k1m6aGrinch': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_4dea8452193446d3bc8abe1ae9d79095/default/dark/2.0',
  'k1m6aHotdog': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3dd3518f01584e1b89401adebc037035/default/dark/2.0',
  'k1m6aHug': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_2650294ab5c14ad789210a5002178c6b/default/dark/2.0',
  'k1m6aHydrate': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c1b78e615a1e4cf9b84566d1e00eebd2/default/dark/2.0',
  'k1m6aHype': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_8aa322d7459e4f86aa65fef5fe5880fb/default/dark/2.0',
  'k1m6aJason': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_85afabbfc15e49c69c9064ae5b8bd6bd/default/dark/2.0',
  'k1m6aKekw': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_48b672a057f74de0b953f7004c66d8b9/default/dark/2.0',
  'k1m6aL': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a383d8c68a0444dd8e2bf1b9ee0b3c30/default/dark/2.0',
  'k1m6aLearn': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_95fb44fddcaf48069e02f4ef5d84ff82/default/dark/2.0',
  'k1m6aLettuce': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_33109ae4e55d45838bf0895d226a8a8c/default/dark/2.0',
  'k1m6aLurk': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dbcaac379c324382b41b6fbc716f3966/default/dark/2.0',
  'k1m6aMod': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ca20669eb3d9410dbe6907d3fb427fd5/default/dark/2.0',
  'k1m6aMoney': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e84f0755bec84b8da286011bcf9503d1/default/dark/2.0',
  'k1m6aNo': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e555a2b5667e4a73bc55f163ff1a6fc9/default/dark/2.0',
  'k1m6aPat': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_300ed456269c49928bc5d0db072a9c95/default/dark/2.0',
  'k1m6aPew': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_d763ee290c774744a6b006754ae6b52b/default/dark/2.0',
  'k1m6aPixel': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_cc583397b8d14507af71592fc3b15c2b/default/dark/2.0',
  'k1m6aPog': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_03b9318aa256404590085b7aad65eb82/default/dark/2.0',
  'k1m6aPopcorn': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_bfdfdcf6304e4ec4a4890449601cc0ba/default/dark/2.0',
  'k1m6aPray': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1b5460d0cb5043d3bb842b222188ac52/default/dark/2.0',
  'k1m6aPride': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_081872353abf446d80cbe106d9755a61/default/dark/2.0',
  'k1m6aPsg': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_57fc02265af64c63b30106e2b83fd75e/default/dark/2.0',
  'k1m6aPuke': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_27486795377745d8a237370db0d08501/default/dark/2.0',
  'k1m6aRage': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_bc68594da22d4efc88c83016d7248eb6/default/dark/2.0',
  'k1m6aRip': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c7fb2c733dde4b898723521a606ff63e/default/dark/2.0',
  'k1m6aSad': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_69b1ba54dc0a4d0890f85f3ab72e0e43/default/dark/2.0',
  'k1m6aShock': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_ffdf2bdc4405492798e761ad16617199/default/dark/2.0',
  'k1m6aSip': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_3687a7632e6a489e9f951fa976947a1b/default/dark/2.0',
  'k1m6aSleep': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_0ef29e6d15f2416a90d7fd4677b6b6e6/default/dark/2.0',
  'k1m6aSmug': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_8a344f3f450944a7932025656003d66c/default/dark/2.0',
  'k1m6aSniper': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f8bca68fd1b04ff4a662c65896f32c19/default/dark/2.0',
  'k1m6aStab': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_076521534f724bec852d2ada23458216/default/dark/2.0',
  'k1m6aStare': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a7ab8ce9904f4ebc8448e9aff4e7f25d/default/dark/2.0',
  'k1m6aSuit': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_a70b975f48634e2c856e06b4d8520534/default/dark/2.0',
  'k1m6aTaptap': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_be90f6cee63445f290b0e03f9e43d43e/default/dark/2.0',
  'k1m6aThink': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c7461b2486334be587e6dc97f344eb32/default/dark/2.0',
  'k1m6aTongue': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_e3685e6f62d5472b8c31714fde236039/default/dark/2.0',
  'k1m6aUmbrella': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_f07b5d75ddf14638add815e7341b113f/default/dark/2.0',
  'k1m6aW': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1ff0e62efa884e619e3bd8d8b05c5704/default/dark/2.0',
  'k1m6aWave': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_eef8c2eca3974415b13dc80f291c2f96/default/dark/2.0',
  'k1m6aWiggle': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_59d9e228421a43dcbdb44d58f2ce4866/default/dark/2.0',
  'k1m6aWink': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_7cf3df4d43324e3d89c0c071fea2f8e4/default/dark/2.0',
  'k1m6aWow': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_45b386bb9be44b0e8b3b72de2da02ce9/default/dark/2.0',
  'k1m6aXmasgift': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_261341b67fe8409baced480af78130e2/default/dark/2.0',
  'k1m6aYes': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1f4eb7f1a0e64f0e91ede6be618e0760/default/dark/2.0',
  'k1m6aZombie': 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_c65f4314d1b94f1c8bd10ba7d139d6c1/default/dark/2.0'
};

// Function to process emotes in text
const processEmotes = (text: string): React.ReactNode => {
  // Sort emote keywords by length (longest first) to avoid partial replacements
  const sortedEmotes = Object.keys(TWITCH_EMOTES).sort((a, b) => b.length - a.length);
  
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  
  // Create a regex pattern for all emotes
  const emotePattern = new RegExp(`\\b(${sortedEmotes.join('|')})\\b`, 'g');
  
  let match;
  while ((match = emotePattern.exec(text)) !== null) {
    // Add text before the emote
    if (match.index > lastIndex) {
      elements.push(text.substring(lastIndex, match.index));
    }
    
    // Add the emote as an image
    const emote = match[1];
    elements.push(
      <img 
        key={`${match.index}-${emote}`}
        src={TWITCH_EMOTES[emote]} 
        alt={emote} 
        style={{ 
          display: 'inline-block',
          width: '24px',
          height: '24px',
          verticalAlign: 'middle',
          margin: '0 2px'
        }}
      />
    );
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add any remaining text
  if (lastIndex < text.length) {
    elements.push(text.substring(lastIndex));
  }
  
  return elements.length > 0 ? <>{elements}</> : text;
};

const LiveChatViewer: React.FC<LiveChatViewerProps> = React.memo(({ disabled = false }) => {
  // Generate truly unique instance ID
  const instanceId = useRef(`LCV_${Date.now()}_${performance.now()}_${++instanceCounter}`);
  
  console.log(`💬 [INIT] Starting LiveChatViewer instance ${instanceId.current}`);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('connecting');
  const [isExpanded, setIsExpanded] = useState(true);
  const [messageCount, setMessageCount] = useState({ twitch: 0, youtube: 0, system: 0, total: 0 });
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [twitchChatEnabled, setTwitchChatEnabled] = useState(true);
  const [isToggling, setIsToggling] = useState(false);
  const [operationStatus, setOperationStatus] = useState<string | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  // Remove local WebSocket ref - we'll use the shared one
  // const wsRef = useRef<WebSocket | null>(null);
  
  // Moderator management state with localStorage persistence
  const [moderatorList, setModeratorList] = useState<string[]>(() => {
    // Load moderators from localStorage on component mount
    try {
      const savedMods = localStorage.getItem('kimbillionaire_moderators');
      if (savedMods) {
        const parsed = JSON.parse(savedMods);
        console.log('💾 Loaded moderators from localStorage:', parsed);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      console.error('Error loading moderators from localStorage:', error);
    }
    return [];
  });
  const [isModeratorDropdownOpen, setIsModeratorDropdownOpen] = useState(false);
  const [newModName, setNewModName] = useState('');
  
  // VIP management state with localStorage persistence
  const [vipList, setVipList] = useState<string[]>(() => {
    try {
      const savedVips = localStorage.getItem('kimbillionaire_vips');
      if (savedVips) {
        const parsed = JSON.parse(savedVips);
        console.log('💎 Loaded VIPs from localStorage:', parsed);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (error) {
      console.error('Error loading VIPs from localStorage:', error);
    }
    return [];
  });
  const [isVipDropdownOpen, setIsVipDropdownOpen] = useState(false);
  const [newVipName, setNewVipName] = useState('');
  // Removed unused showModDropdown and isModLoading variables

  // Host chat input state
  const [hostMessage, setHostMessage] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const MAX_RECONNECT_ATTEMPTS = 5;
  const reconnectAttemptsRef = useRef(0);

  // processEmotes function is defined above (line 190) to handle Twitch emote replacement

  // Message handler
  const handleMessage = useCallback((chatMessage: ChatMessage) => {
    console.log('💬 [MESSAGE] Received message for processing:', chatMessage);
    
    const messageWithFlags = {
      ...chatMessage,
      isModerator: moderatorList.includes(chatMessage.username.toLowerCase()),
      isVip: vipList.includes(chatMessage.username.toLowerCase())
    };

    setMessages(prev => {
      const exists = prev.some(msg => msg.id === messageWithFlags.id);
      if (exists) {
        console.log('💬 Duplicate message detected, ignoring:', messageWithFlags.id);
        return prev;
      }
      return [...prev.slice(-99), messageWithFlags];
    });

    // Update message counts
    setMessageCount(prev => ({
      ...prev,
      [chatMessage.platform]: prev[chatMessage.platform] + 1,
      total: prev.total + 1
    }));

    // Auto-scroll to bottom
    setTimeout(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    }, 50);
  }, [moderatorList, vipList]);

  // Fetch mods and VIPs from server on component mount
  useEffect(() => {
    const fetchModsAndVips = async () => {
      try {
        console.log('📡 Fetching mods/VIPs from:', `${API_BASE_URL}/api/mods`);
        
        // Fetch moderators from server
        const modsResponse = await fetch(`${API_BASE_URL}/api/mods`);
        console.log('📡 Mods response status:', modsResponse.status);
        
        if (modsResponse.ok) {
          const modsData = await modsResponse.json();
          console.log('📡 Mods data received:', modsData);
          
          if (modsData.success && Array.isArray(modsData.mods)) {
            console.log('🛡️ Loaded moderators from server:', modsData.mods);
            setModeratorList(modsData.mods);
          }
        } else {
          console.warn('⚠️ Failed to fetch moderators from server, status:', modsResponse.status);
        }
        
        // Fetch VIPs from server
        const vipsResponse = await fetch(`${API_BASE_URL}/api/vips`);
        console.log('📡 VIPs response status:', vipsResponse.status);
        
        if (vipsResponse.ok) {
          const vipsData = await vipsResponse.json();
          console.log('📡 VIPs data received:', vipsData);
          
          if (vipsData.success && Array.isArray(vipsData.vips)) {
            console.log('💎 Loaded VIPs from server:', vipsData.vips);
            setVipList(vipsData.vips);
          }
        } else {
          console.warn('⚠️ Failed to fetch VIPs from server, status:', vipsResponse.status);
        }
      } catch (error) {
        console.error('❌ Error fetching mods/VIPs from server:', error);
        if (error instanceof Error) {
          console.error('❌ Error details:', error.message);
        }
      }
    };
    
    // Add a small delay to ensure server is ready
    setTimeout(() => {
      fetchModsAndVips();
    }, 1000);
  }, []); // Run once on mount
  
  // Function to sync moderator list with server
  const updateModeratorList = async (newList: string[]) => {
    setModeratorList(newList);
    try {
      const response = await fetch(`${API_BASE_URL}/api/mods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mods: newList })
      });
      if (response.ok) {
        console.log('✅ Moderator list synced with server');
      } else {
        console.warn('⚠️ Failed to sync moderator list with server');
      }
    } catch (error) {
      console.error('❌ Error syncing moderator list:', error);
    }
  };
  
  // Function to sync VIP list with server
  const updateVipList = async (newList: string[]) => {
    setVipList(newList);
    try {
      const response = await fetch(`${API_BASE_URL}/api/vips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vips: newList })
      });
      if (response.ok) {
        console.log('✅ VIP list synced with server');
      } else {
        console.warn('⚠️ Failed to sync VIP list with server');
      }
    } catch (error) {
      console.error('❌ Error syncing VIP list:', error);
    }
  };

  // Save moderators to localStorage whenever the list changes
  useEffect(() => {
    try {
      localStorage.setItem('kimbillionaire_moderators', JSON.stringify(moderatorList));
      console.log('💾 Saved moderators to localStorage:', moderatorList);
    } catch (error) {
      console.error('Error saving moderators to localStorage:', error);
    }
  }, [moderatorList]);

  // Save VIPs to localStorage whenever the list changes
  useEffect(() => {
    try {
      localStorage.setItem('kimbillionaire_vips', JSON.stringify(vipList));
      console.log('💾 Saved VIPs to localStorage:', vipList);
    } catch (error) {
      console.error('Error saving VIPs to localStorage:', error);
    }
  }, [vipList]);

  // Singleton WebSocket connection management
  const connectWebSocket = useCallback(() => {
    console.log(`💬 [${instanceId.current}] Checking WebSocket connection to ${WS_BASE_URL}`);
    
    // If already connected, just register this component's handler
    if (sharedWebSocket && sharedWebSocket.readyState === WebSocket.OPEN) {
      console.log(`💬 [${instanceId.current}] Using existing WebSocket connection`);
      setIsConnected(true);
      setConnectionStatus('connected');
      messageHandlers.add(handleMessage);
      return;
    }
    
    // If connection is in progress, wait for it
    if (connectionPromise) {
      console.log(`💬 [${instanceId.current}] Waiting for existing connection attempt`);
      connectionPromise.then(() => {
        if (sharedWebSocket && sharedWebSocket.readyState === WebSocket.OPEN) {
          setIsConnected(true);
          setConnectionStatus('connected');
          messageHandlers.add(handleMessage);
        }
      });
      return;
    }

    console.log(`💬 [${instanceId.current}] Creating new shared WebSocket connection to ${WS_BASE_URL}`);
    setConnectionStatus('connecting');
    setReconnectAttempt(reconnectAttemptsRef.current);
    
    // Create connection promise to prevent multiple simultaneous attempts
    connectionPromise = new Promise<void>((resolve, reject) => {
      try {
        console.log(`💬 [${instanceId.current}] Attempting WebSocket connection to: ${WS_BASE_URL}`);
        sharedWebSocket = new WebSocket(WS_BASE_URL);
        console.log(`💬 [${instanceId.current}] WebSocket object created, readyState:`, sharedWebSocket.readyState);

        sharedWebSocket.onopen = () => {
          console.log('💬 ✅ [CONNECTION] Shared WebSocket connected successfully');
          reconnectAttemptsRef.current = 0;
          connectionPromise = null;
          
          // IMMEDIATELY register as chat viewer - don't wait
          console.log('💬 [REGISTRATION] Registering as chat_viewer immediately...');
          
          const registrationMessage = {
            type: 'register',
            client: 'chat_viewer',
            instanceId: instanceId.current
          };
          console.log('💬 [REGISTRATION] Sending registration message:', registrationMessage);
          
          // Add a small delay to ensure WebSocket is fully established
          setTimeout(() => {
            try {
              // Send registration with validation
              if (sharedWebSocket && sharedWebSocket.readyState === WebSocket.OPEN) {
                sharedWebSocket.send(JSON.stringify(registrationMessage));
                console.log('💬 ✅ [REGISTRATION] Registration message sent successfully');
                
                // Only after successful registration, update status
                setIsConnected(true);
                setConnectionStatus('connected');
                
                // Notify all waiting components
                resolve();
              } else {
                console.error('💬 ❌ [REGISTRATION] WebSocket not open, state:', sharedWebSocket?.readyState);
                reject(new Error('WebSocket not in OPEN state'));
                return;
              }
            } catch (error) {
              console.error('💬 ❌ [REGISTRATION] Exception sending registration:', error);
              reject(error);
            }
          }, 100); // 100ms delay to ensure connection is stable
        };

        sharedWebSocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('💬 [MESSAGE] Shared WebSocket message received:', message.type);
            
            if (message.type === 'chat_message') {
              console.log('💬 [MESSAGE] Broadcasting to', messageHandlers.size, 'handlers');
              
              // Ensure message has required fields
              const processedMessage: ChatMessage = {
                id: message.id || `${message.username || 'anonymous'}_${message.timestamp || Date.now()}`,
                username: message.username || 'Anonymous',
                text: message.text || '[No message]',
                platform: message.platform || 'unknown' as any,
                timestamp: message.timestamp || Date.now(),
                isModerator: message.isModerator || false
              };
              
              // Notify all registered handlers
              messageHandlers.forEach(handler => {
                handler(processedMessage);
              });
            } else if (message.type === 'mod_response') {
              console.log('🛡️ [MOD_RESPONSE] Ask a Mod response received from:', message.response?.username);
              
              // Process Ask a Mod response and display as special chat message
              const modResponse = message.response;
              if (modResponse) {
                const askAModMessage: ChatMessage = {
                  id: `mod_${modResponse.username}_${modResponse.timestamp}`,
                  username: modResponse.username,
                  text: `🛡️ ${modResponse.message}`,
                  platform: modResponse.platform || 'twitch' as any,
                  timestamp: modResponse.timestamp,
                  isModerator: true,
                  isAskAModResponse: true,
                  suggestedAnswer: modResponse.suggestedAnswer
                };
                
                console.log('🛡️ [MOD_RESPONSE] Broadcasting Ask a Mod response to', messageHandlers.size, 'handlers');
                
                // Notify all registered handlers
                messageHandlers.forEach(handler => {
                  handler(askAModMessage);
                });
              }
            }
          } catch (error) {
            console.error('💬 Error parsing WebSocket message:', error);
          }
        };

        sharedWebSocket.onerror = (event) => {
          console.error('💬 ❌ [ERROR] WebSocket error event occurred');
          
          // Get the current WebSocket state safely
          const ws = sharedWebSocket;
          if (ws) {
            const readyState = ws.readyState;
            const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
            const stateName = stateNames[readyState] || 'UNKNOWN';
            
            console.error('  - readyState:', readyState, `(${stateName})`);
            console.error('  - connecting to:', WS_BASE_URL);
          } else {
            console.error('  - WebSocket object is null');
          }
          
          // Note: WebSocket error events don't contain much information for security reasons
          console.error('  - event type:', event.type);
          console.error('  - instance:', instanceId.current);
          
          // Update connection status (this will affect all components using the shared connection)
          setConnectionStatus('error');
          
          // Don't reject immediately - error events are often followed by close events
          // The close handler will handle the rejection and reconnection logic
        };

        sharedWebSocket.onclose = (event) => {
          console.log('💬 🔌 [CONNECTION] Shared WebSocket connection closed:');
          console.log('  - Code:', event.code);
          console.log('  - Reason:', event.reason || '(no reason provided)');
          console.log('  - Clean:', event.wasClean);
          console.log('  - URL:', WS_BASE_URL);
          
          sharedWebSocket = null;
          connectionPromise = null;
          
          // Notify all components using the shared connection
          setIsConnected(false);
          setConnectionStatus('error');
          
          // Clear all handlers on connection close
          messageHandlers.clear();
          
          // Handle reconnection based on close code
          const isNormalClosure = event.code === 1000 || event.code === 1001;
          
          if (!isNormalClosure && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(1000 + (reconnectAttemptsRef.current * 2000), 10000);
            console.log(`💬 [RECONNECT] Scheduling reconnection in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);
            
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectAttemptsRef.current++;
              connectionPromise = null; // Clear the promise before reconnecting
              connectWebSocket();
            }, delay);
          } else if (isNormalClosure) {
            console.log('💬 [CONNECTION] Normal closure, not attempting reconnection');
          } else {
            console.error('💬 ❌ [CONNECTION] Max reconnection attempts reached. Connection failed permanently.');
          }
        };
      } catch (error) {
        console.error('💬 ❌ [ERROR] Exception creating WebSocket:', error);
        connectionPromise = null;
        sharedWebSocket = null;
        
        // Schedule retry for creation failures
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 + (reconnectAttemptsRef.current * 2000), 10000);
          console.log(`💬 [RECONNECT] Will retry after creation error in ${delay}ms`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connectWebSocket();
          }, delay);
        }
        
        reject(error);
      }
    });
    
    // Add this component's handler after connection setup
    connectionPromise.then(() => {
      messageHandlers.add(handleMessage);
      setIsConnected(true);
      setConnectionStatus('connected');
    }).catch(() => {
      setConnectionStatus('error');
    });
  }, [handleMessage]); // Only depend on handleMessage which is memoized

  // Initialize connection on mount
  useEffect(() => {
    // Capture the current instance ID at the start of the effect
    const currentInstanceId = instanceId.current;
    
    console.log(`💬 [SETUP] Initializing connection for instance ${currentInstanceId}`);
    console.log(`📊 Initial states:`, { 
      isConnected, 
      connectionStatus,
      WS_BASE_URL,
      API_BASE_URL 
    });
    
    connectWebSocket();
    
    // Auto-connect to Twitch chat on mount
    if (!twitchChatEnabled) {
      console.log('🚀 Auto-connecting to Twitch chat on mount...');
      // Use a small delay to ensure component is fully mounted
      setTimeout(() => {
        connectAndStartChat();
      }, 500);
    }
    
    // Add a timer to check connection state after mount
    const checkTimer = setTimeout(() => {
      console.log(`📊 Connection state after 3s:`, { 
        isConnected, 
        connectionStatus,
        sharedWebSocket: sharedWebSocket ? 'exists' : 'null',
        readyState: sharedWebSocket?.readyState 
      });
    }, 3000);

    return () => {
      console.log(`💬 [CLEANUP] Cleaning up instance ${currentInstanceId}`);
      clearTimeout(checkTimer);
      
      // Remove this component's handler
      messageHandlers.delete(handleMessage);
      
      // Clear reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // If this was the last handler, close the shared connection
      if (messageHandlers.size === 0 && sharedWebSocket) {
        console.log('💬 [CLEANUP] Last handler removed, closing shared WebSocket');
        sharedWebSocket.close();
        sharedWebSocket = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array - only run on mount

  // Unified connect and start functionality
  const connectAndStartChat = async () => {
    setIsToggling(true);
    setOperationStatus(null);
    
    try {
      if (twitchChatEnabled) {
        // If chat is running, stop and disconnect
        setOperationStatus('Stopping chat process...');
        const response = await fetch(`${API_BASE_URL}/api/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'twitch_chat_stop' }),
        });
        
        if (response.ok) {
          setOperationStatus('Disconnecting from Twitch...');
          // Also disconnect the configuration
          await fetch(`${API_BASE_URL}/api/polling/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'disconnect' })
          });
          
          setTwitchChatEnabled(false);
          setOperationStatus('✅ Successfully disconnected');
          console.log('✅ Twitch chat stopped and disconnected');
        }
      } else {
        // Connect and start process: First save config, then start chat
        console.log('🔄 Starting unified connect and start process...');
        
        setOperationStatus('Configuring connection to k1m6a...');
        // Step 1: Save configuration with k1m6a as default channel
        const configResponse = await fetch(`${API_BASE_URL}/api/polling/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_config',
            config: {
              twitch: {
                channel: 'k1m6a', // Default channel
                username: 'justinfan12345'
              },
              youtube: {
                apiKey: '',
                liveChatId: '',
                pollingInterval: 5000
              },
              isActive: true
            }
          })
        });

        if (!configResponse.ok) {
          throw new Error('Failed to save chat configuration');
        }
        
        console.log('✅ Chat configuration saved');
        setOperationStatus('Starting chat monitoring...');
        
        // Step 2: Start the Twitch chat process
        const chatResponse = await fetch(`${API_BASE_URL}/api/control`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'twitch_chat_start' }),
        });
        
        if (chatResponse.ok) {
          setTwitchChatEnabled(true);
          setOperationStatus('✅ Connected and monitoring k1m6a chat');
          console.log('✅ Chat connected and started successfully');
        } else {
          throw new Error('Failed to start chat process');
        }
      }
      
      // Clear status after 3 seconds
      setTimeout(() => setOperationStatus(null), 3000);
      
    } catch (error) {
      console.error('❌ Error in unified chat operation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setOperationStatus(`❌ ${errorMessage}`);
      setTimeout(() => setOperationStatus(null), 5000);
    } finally {
      setIsToggling(false);
    }
  };

  // Send host message functionality
  const sendHostMessage = async () => {
    if (!hostMessage.trim() || isSendingMessage) return;

    console.log('📤 Attempting to send host message:', hostMessage);
    console.log('📊 Connection state:', { isConnected, connectionStatus });

    setIsSendingMessage(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'send_host_message',
          message: hostMessage.trim()
        }),
      });

      if (response.ok) {
        setHostMessage('');
        console.log('✅ Host message sent successfully');
        // Message will appear via WebSocket broadcast from server
      } else {
        console.error('❌ Server rejected host message:', response.status);
      }
    } catch (error) {
      console.error('❌ Error sending host message:', error);
      alert('Failed to send message. Please check server connection.');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return '#00ff00';
      case 'connecting': return '#ffaa00';
      case 'error': return '#ff0000';
      default: return '#888888';
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'error': return reconnectAttempt < MAX_RECONNECT_ATTEMPTS ? 'Reconnecting...' : 'Failed';
      default: return 'Disconnected';
    }
  };

  return (
    <GlassPanel title="Live Chat Viewer" className={styles.chatPanel}>
      <div className={styles.liveChatViewer}>
        {/* Header with connection status and controls */}
        <div className={styles.chatHeader}>
          <div className={styles.connectionStatus}>
            <div 
              className={styles.statusIndicator} 
              style={{ backgroundColor: getConnectionStatusColor() }}
            />
            <span className={styles.statusText}>
              {getConnectionStatusText()}
              {reconnectAttempt > 0 && ` (${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`}
            </span>
          </div>
          
          <div className={styles.chatControls}>
            <button
              className={twitchChatEnabled ? styles.dangerBtn : styles.primaryBtn}
              onClick={connectAndStartChat}
              disabled={isToggling}
              style={{ 
                padding: '4px 8px', 
                fontSize: '11px',
                opacity: isToggling ? 0.5 : 1,
                cursor: isToggling ? 'not-allowed' : 'pointer'
              }}
              title={twitchChatEnabled ? 'Stop chat and disconnect from Twitch' : 'Connect to Twitch and start chat monitoring'}
            >
              {isToggling ? '⏳ Working...' : (twitchChatEnabled ? '🛑 Stop & Disconnect' : '🚀 Connect & Start')}
            </button>
            
            <button
              className={styles.secondaryBtn}
              onClick={() => setIsExpanded(!isExpanded)}
              style={{ padding: '4px 8px', fontSize: '11px' }}
            >
              {isExpanded ? '📦 Collapse' : '📖 Expand'}
            </button>
          </div>
        </div>

        {/* Operation Status Display */}
        {operationStatus && (
          <div style={{
            marginBottom: '10px',
            padding: '8px 12px',
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '6px',
            fontSize: '12px',
            color: '#3b82f6',
            textAlign: 'center'
          }}>
            {operationStatus}
          </div>
        )}

        {/* Message counts */}
        <div className={styles.messageStats}>
          <span>Total: {messageCount.total}</span>
          <span>Twitch: {messageCount.twitch}</span>
          <span>YouTube: {messageCount.youtube}</span>
          <span>System: {messageCount.system}</span>
        </div>

        {/* Moderator management - Dropdown Style */}
        <div className={styles.moderatorSection} style={{ marginTop: '10px', position: 'relative' }}>
          <h4 style={{ fontSize: '12px', marginBottom: '5px' }}>Moderators</h4>
          
          {/* Compact dropdown button */}
          <button
            onClick={() => setIsModeratorDropdownOpen(!isModeratorDropdownOpen)}
            style={{
              width: '100%',
              padding: '6px 12px',
              fontSize: '12px',
              backgroundColor: 'rgba(255, 215, 0, 0.1)',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              borderRadius: '6px',
              color: '#FFD700',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '5px'
            }}
          >
            <span>🛡️ Moderators ({moderatorList.length})</span>
            <span style={{ transform: isModeratorDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
          </button>

          {/* Dropdown content */}
          {isModeratorDropdownOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '0',
              right: '0',
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              borderRadius: '6px',
              padding: '8px',
              zIndex: 1000,
              boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)'
            }}>
              {/* Add moderator input */}
              <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                <input
                  type="text"
                  placeholder="Add moderator username..."
                  value={newModName}
                  onChange={(e) => setNewModName(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && newModName.trim()) {
                      const modName = newModName.trim().toLowerCase();
                      if (!moderatorList.includes(modName)) {
                        updateModeratorList([...moderatorList, modName]);
                        setNewModName('');
                      }
                    }
                  }}
                  style={{ 
                    flex: 1, 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    border: '1px solid rgba(255, 215, 0, 0.3)',
                    borderRadius: '4px',
                    color: '#fff'
                  }}
                />
                <button
                  onClick={() => {
                    if (newModName.trim()) {
                      const modName = newModName.trim().toLowerCase();
                      if (!moderatorList.includes(modName)) {
                        updateModeratorList([...moderatorList, modName]);
                        setNewModName('');
                      }
                    }
                  }}
                  disabled={!newModName.trim()}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    opacity: newModName.trim() ? 1 : 0.5,
                    cursor: newModName.trim() ? 'pointer' : 'not-allowed'
                  }}
                  className={styles.primaryBtn}
                >
                  Add
                </button>
              </div>
              
              {/* Scrollable moderator list */}
              <div style={{ 
                maxHeight: '120px', 
                overflowY: 'auto',
                overflowX: 'hidden'
              }}>
                {moderatorList.length === 0 ? (
                  <div style={{ 
                    color: '#888', 
                    fontSize: '11px', 
                    textAlign: 'center', 
                    padding: '8px' 
                  }}>
                    No moderators added yet
                  </div>
                ) : (
                  moderatorList.map((mod, index) => (
                    <div 
                      key={index}
                      style={{ 
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '4px 8px',
                        marginBottom: '2px',
                        backgroundColor: 'rgba(255, 215, 0, 0.1)',
                        border: '1px solid rgba(255, 215, 0, 0.2)',
                        borderRadius: '4px',
                        fontSize: '11px'
                      }}
                    >
                      <span style={{ color: '#FFD700' }}>🛡️ {mod}</span>
                      <button
                        onClick={() => updateModeratorList(moderatorList.filter((_, i) => i !== index))}
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          color: '#ff6b6b',
                          cursor: 'pointer',
                          padding: '0 4px',
                          fontSize: '14px',
                          borderRadius: '2px'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* VIP management - Dropdown Style */}
        <div className={styles.vipSection} style={{ marginTop: '10px', position: 'relative' }}>
          <h4 style={{ fontSize: '12px', marginBottom: '5px' }}>VIPs</h4>
          
          {/* Compact dropdown button */}
          <button
            onClick={() => setIsVipDropdownOpen(!isVipDropdownOpen)}
            style={{
              width: '100%',
              padding: '6px 12px',
              fontSize: '12px',
              backgroundColor: 'rgba(255, 20, 147, 0.1)',
              border: '1px solid rgba(255, 20, 147, 0.3)',
              borderRadius: '6px',
              color: '#FF1493',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '5px'
            }}
          >
            <span>💎 VIPs ({vipList.length})</span>
            <span style={{ transform: isVipDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
          </button>

          {/* Dropdown content */}
          {isVipDropdownOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '0',
              right: '0',
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              border: '1px solid rgba(255, 20, 147, 0.3)',
              borderRadius: '6px',
              padding: '8px',
              zIndex: 1000,
              boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)'
            }}>
              {/* Add VIP input */}
              <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                <input
                  type="text"
                  placeholder="Add VIP username..."
                  value={newVipName}
                  onChange={(e) => setNewVipName(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && newVipName.trim()) {
                      const vipName = newVipName.trim().toLowerCase();
                      if (!vipList.includes(vipName)) {
                        updateVipList([...vipList, vipName]);
                        setNewVipName('');
                      }
                    }
                  }}
                  style={{ 
                    flex: 1, 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    border: '1px solid rgba(255, 20, 147, 0.3)',
                    borderRadius: '4px',
                    color: '#fff'
                  }}
                />
                <button
                  onClick={() => {
                    if (newVipName.trim()) {
                      const vipName = newVipName.trim().toLowerCase();
                      if (!vipList.includes(vipName)) {
                        updateVipList([...vipList, vipName]);
                        setNewVipName('');
                      }
                    }
                  }}
                  disabled={!newVipName.trim()}
                  style={{ 
                    padding: '4px 8px', 
                    fontSize: '11px',
                    backgroundColor: 'rgba(255, 20, 147, 0.3)',
                    border: '1px solid rgba(255, 20, 147, 0.5)',
                    borderRadius: '4px',
                    color: '#FF1493',
                    opacity: newVipName.trim() ? 1 : 0.5,
                    cursor: newVipName.trim() ? 'pointer' : 'not-allowed'
                  }}
                  className={styles.primaryBtn}
                >
                  Add
                </button>
              </div>
              
              {/* Scrollable VIP list */}
              <div style={{ 
                maxHeight: '120px', 
                overflowY: 'auto',
                overflowX: 'hidden'
              }}>
                {vipList.length === 0 ? (
                  <div style={{ 
                    color: '#888', 
                    fontSize: '11px', 
                    textAlign: 'center', 
                    padding: '8px' 
                  }}>
                    No VIPs added yet
                  </div>
                ) : (
                  vipList.map((vip, index) => (
                    <div 
                      key={index}
                      style={{ 
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '4px 8px',
                        marginBottom: '2px',
                        backgroundColor: 'rgba(255, 20, 147, 0.1)',
                        border: '1px solid rgba(255, 20, 147, 0.2)',
                        borderRadius: '4px',
                        fontSize: '11px'
                      }}
                    >
                      <span style={{ color: '#FF1493' }}>💎 {vip}</span>
                      <button
                        onClick={() => updateVipList(vipList.filter((_, i) => i !== index))}
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          color: '#ff6b6b',
                          cursor: 'pointer',
                          padding: '0 4px',
                          fontSize: '14px',
                          borderRadius: '2px'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Chat messages container */}
        {isExpanded && (
          <div 
            ref={chatContainerRef}
            className={styles.chatContainer}
            style={{ 
              height: '400px', 
              overflowY: 'auto',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              borderRadius: '8px',
              padding: '10px',
              backgroundColor: 'rgba(0, 0, 0, 0.2)'
            }}
          >
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#888', padding: '20px' }}>
                {connectionStatus === 'connected' ? 'Waiting for messages...' : 'Not connected to chat'}
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={styles.chatMessage} style={{ marginBottom: '8px' }}>
                  <div className={styles.messageHeader}>
                    <span 
                      className={styles.username}
                      style={{ 
                        color: msg.username === 'HOST' ? '#FFD700' : (msg.isModerator ? '#00ff00' : (msg.isVip ? '#FF1493' : '#ffffff')),
                        fontWeight: msg.username === 'HOST' || msg.isModerator || msg.isVip ? 'bold' : 'normal'
                      }}
                    >
                      {msg.username === 'HOST' && '👑'} {msg.isModerator && '🛡️'} {msg.isVip && '💎'} {msg.username}
                    </span>
                    <span className={styles.platform} style={{ color: '#888', fontSize: '10px' }}>
                      [{msg.platform}]
                    </span>
                    <span className={styles.timestamp} style={{ color: '#666', fontSize: '10px' }}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className={styles.messageContent} style={{ color: '#ddd', marginTop: '2px' }}>
                    {processEmotes(msg.text)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Host message input - moved to bottom like Twitch */}
        {isExpanded && (
          <div className={styles.hostMessageInput} style={{ marginTop: '10px' }}>
            {/* Connection status indicator */}
            {!isConnected && (
              <div style={{ 
                fontSize: '11px', 
                color: '#ff6b6b', 
                marginBottom: '5px',
                textAlign: 'center'
              }}>
                ⚠️ WebSocket not connected - messages will be queued
              </div>
            )}
            <div style={{ display: 'flex', gap: '5px' }}>
              <input
                type="text"
                placeholder="Send a message"
                value={hostMessage}
                onChange={(e) => setHostMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendHostMessage()}
                disabled={isSendingMessage}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  fontSize: '13px',
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  border: '1px solid rgba(255, 215, 0, 0.2)',
                  borderRadius: '4px',
                  color: '#fff',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  cursor: isSendingMessage ? 'not-allowed' : 'text'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(255, 215, 0, 0.5)';
                  e.target.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
                  e.target.style.boxShadow = '0 0 0 2px rgba(255, 215, 0, 0.2)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255, 215, 0, 0.2)';
                  e.target.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
                  e.target.style.boxShadow = 'none';
                }}
              />
              <button
                onClick={sendHostMessage}
                disabled={isSendingMessage || !hostMessage.trim()}
                style={{
                  padding: '10px 20px',
                  fontSize: '13px',
                  backgroundColor: (isSendingMessage || !hostMessage.trim()) ? 'rgba(100, 100, 100, 0.3)' : 'rgba(130, 80, 255, 0.8)',
                  border: 'none',
                  borderRadius: '4px',
                  color: (isSendingMessage || !hostMessage.trim()) ? '#666' : '#fff',
                  cursor: (isSendingMessage || !hostMessage.trim()) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  fontWeight: '600'
                }}
                onMouseEnter={(e) => {
                  if (!isSendingMessage && hostMessage.trim()) {
                    e.currentTarget.style.backgroundColor = 'rgba(130, 80, 255, 0.9)';
                    e.currentTarget.style.transform = 'scale(1.02)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = (isSendingMessage || !hostMessage.trim()) ? 'rgba(100, 100, 100, 0.3)' : 'rgba(130, 80, 255, 0.8)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                {isSendingMessage ? 'Sending...' : 'Chat'}
              </button>
            </div>
          </div>
        )}
      </div>
    </GlassPanel>
  );
});

export default LiveChatViewer;

// Set display name for debugging
LiveChatViewer.displayName = 'LiveChatViewer';