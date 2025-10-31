const axios = require('axios');
const { request, gql } = require('graphql-request');
const utils = require('../utils');

const PHAR = '0x13A466998Ce03Db73aBc2d4DF3bBD845Ed1f28E7';
const PROJECT = 'pharaoh-v3';
const CHAIN = 'avalanche';
const SUBGRAPH = 'https://avalanchev2.kingdomsubgraph.com/subgraphs/name/pharaoh-v3-pruned/';

const poolsQuery = gql`
  query getPools($first: Int!, $skip: Int!) {
    clPools(
      first: $first
      skip: $skip
      orderBy: totalValueLockedUSD
      orderDirection: desc
      where: { gauge_not: null }
    ) {
      id
      token0 {
        id
        symbol
      }
      token1 {
        id
        symbol
      }
      feeTier
      tickSpacing
      totalValueLockedUSD
      gauge {
        id
      }
      poolDayData(first: 7, orderBy: startOfDay, orderDirection: desc) {
        volumeUSD
      }
    }
  }
`;

async function fetchAllPools() {
  let allPools = [];
  let skip = 0;
  const first = 1000;

  while (true) {
    const poolsData = await request(SUBGRAPH, poolsQuery, { first, skip });
    const pools = poolsData.clPools;

    if (pools.length === 0) break;

    allPools = allPools.concat(pools);

    if (pools.length < first) break;

    skip += first;
  }

  return allPools;
}

async function apy() {
  try {
    const pools = await fetchAllPools();

    let pharaohPools = [];
    try {
      const pharaohApiData = await axios.get('https://api.phar.fi/mixed-pairs?includeTokens=False');
      if (pharaohApiData.data && Array.isArray(pharaohApiData.data.pairs)) {
        pharaohPools = pharaohApiData.data.pairs;
      }
    } catch (error) {
      console.error('Failed to fetch Pharaoh API data:', error.message);
    }

    const aprMap = {};
    for (const pool of pharaohPools) {
      if (pool.id) {
        aprMap[pool.id.toLowerCase()] = {
          lpApr: Number(pool.lpApr) || 0
        };
      }
    }

    const results = [];

    for (const pool of pools) {
      const tvlUsd = Number(pool.totalValueLockedUSD) || 0;

      if (!pool.gauge?.id) continue;

      const poolAddress = pool.id.toLowerCase();
      const apiData = aprMap[poolAddress];

      if (!apiData) continue;

      const apyBase = 0;
      let apyReward = 0;
      const tickSpacing = parseInt(pool.tickSpacing);

      const apiPool = pharaohPools.find(p => p.id.toLowerCase() === poolAddress);
      if (apiPool && apiPool.recommendedRangesNew) {
        if (tickSpacing === 1 || tickSpacing === 5) {
          const wideRange = apiPool.recommendedRangesNew.find(range => range.name === 'Wide');
          apyReward = wideRange ? wideRange.lpApr : apiData.lpApr || 0;
        } else {
          const narrowRange = apiPool.recommendedRangesNew.find(range => range.name === 'Narrow');
          apyReward = narrowRange ? narrowRange.lpApr : apiData.lpApr || 0;
        }
      } else {
        apyReward = apiData.lpApr || 0;
      }

      results.push({
        pool: `${poolAddress}-${utils.formatChain(CHAIN)}`.toLowerCase(),
        chain: utils.formatChain(CHAIN),
        project: PROJECT,
        poolMeta: `CL ${(Number(pool.feeTier) / 10000).toFixed(2)}%`,
        symbol: `${pool.token0.symbol}-${pool.token1.symbol}`,
        tvlUsd,
        apyBase,
        apyBase7d: 0,
        apyReward,
        rewardTokens: apyReward > 0 ? [PHAR] : [],
        underlyingTokens: [
          pool.token0.id.toLowerCase(),
          pool.token1.id.toLowerCase()
        ],
        url: `https://www.phar.gg/liquidity/${poolAddress}`,
        volumeUsd1d: pool.poolDayData?.[0]?.volumeUSD
          ? Number(pool.poolDayData[0].volumeUSD)
          : 0,
        volumeUsd7d: pool.poolDayData
          ? pool.poolDayData.reduce((sum, day) => sum + Number(day.volumeUSD || 0), 0)
          : 0,
      });
    }

    return results.filter((p) => utils.keepFinite(p));
    
  } catch (error) {
    console.error('Error fetching Pharaoh CL data:', error);
    return [];
  }
}

module.exports = {
  timetravel: false,
  apy: apy,
};