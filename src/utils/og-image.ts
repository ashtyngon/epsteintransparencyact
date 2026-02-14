import satori from 'satori';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE_NAME = 'EPSTEIN TRANSPARENCY PROJECT';

const fontsDir = join(process.cwd(), 'src/fonts');
const interBold = readFileSync(join(fontsDir, 'inter-bold.ttf'));
const notoSerifBold = readFileSync(join(fontsDir, 'noto-serif-bold.ttf'));

export async function generateOgImage(options: {
  title: string;
  subtitle?: string;
  tag?: string;
  date?: string;
}): Promise<Buffer> {
  const { title, subtitle, tag, date } = options;

  const displayTitle = title.length > 120 ? title.substring(0, 117) + '...' : title;
  const displaySubtitle = subtitle
    ? subtitle.length > 160 ? subtitle.substring(0, 157) + '...' : subtitle
    : null;
  const fontSize = displayTitle.length > 80 ? 42 : displayTitle.length > 50 ? 48 : 56;

  // Build top label text
  const topLabel = [tag, date].filter(Boolean).join('  |  ');

  // Build the element tree — every parent div with multiple children has display: flex
  const element = {
    type: 'div',
    props: {
      style: {
        width: '1200px',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '60px 70px',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
        fontFamily: 'Noto Serif',
      },
      children: [
        // Top: tag/date label
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            },
            children: topLabel
              ? [
                  ...(tag ? [{
                    type: 'div',
                    props: {
                      style: {
                        background: '#dc2626',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: 700,
                        fontFamily: 'Inter',
                        textTransform: 'uppercase' as const,
                        letterSpacing: '0.08em',
                        padding: '4px 12px',
                        display: 'flex',
                      },
                      children: tag,
                    },
                  }] : []),
                  ...(date ? [{
                    type: 'div',
                    props: {
                      style: {
                        color: 'rgba(255,255,255,0.4)',
                        fontSize: '14px',
                        fontFamily: 'Inter',
                        fontWeight: 700,
                        display: 'flex',
                      },
                      children: date,
                    },
                  }] : []),
                ]
              : ' ',
          },
        },
        // Middle: title + subtitle
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              flex: '1',
              justifyContent: 'center',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: `${fontSize}px`,
                    fontWeight: 700,
                    color: 'white',
                    lineHeight: 1.15,
                    letterSpacing: '-0.02em',
                    display: 'flex',
                  },
                  children: displayTitle,
                },
              },
              ...(displaySubtitle ? [{
                type: 'div',
                props: {
                  style: {
                    fontSize: '22px',
                    color: 'rgba(255,255,255,0.5)',
                    lineHeight: 1.4,
                    fontWeight: 400,
                    display: 'flex',
                  },
                  children: displaySubtitle,
                },
              }] : []),
            ],
          },
        },
        // Bottom: red line + site name
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    width: '100%',
                    height: '3px',
                    background: '#dc2626',
                    display: 'flex',
                  },
                  children: ' ',
                },
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontSize: '14px',
                          fontWeight: 700,
                          fontFamily: 'Inter',
                          color: 'rgba(255,255,255,0.5)',
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase' as const,
                          display: 'flex',
                        },
                        children: SITE_NAME,
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontSize: '13px',
                          fontFamily: 'Inter',
                          fontWeight: 700,
                          color: 'rgba(255,255,255,0.3)',
                          display: 'flex',
                        },
                        children: 'epsteintransparencyact.com',
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  };

  const svg = await satori(element as any, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: 'Inter',
        data: interBold,
        weight: 700,
        style: 'normal',
      },
      {
        name: 'Noto Serif',
        data: notoSerifBold,
        weight: 700,
        style: 'normal',
      },
    ],
  });

  const png = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
  return png;
}
