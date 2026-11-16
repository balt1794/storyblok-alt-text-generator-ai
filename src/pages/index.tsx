import Head from 'next/head';
import { useAppBridge } from '@/hooks';
import AltTextApp from '@/components/AltTextApp';

export default function Home() {
	const { completed } = useAppBridge({ type: 'space-plugin', oauth: true });

	return (
		<>
			<Head>
				<title>Alt Text Generator AI</title>
				<meta name="description" content="Write alt text for the images in your Storyblok space." />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
			</Head>
			<main>{completed && <AltTextApp />}</main>
		</>
	);
}
