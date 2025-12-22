import packageJson from '../../../package.json';

function About() {
  return (
    <div>
      <h1>About</h1>
      <h2>Version: {packageJson.version}</h2>
    </div>
  );
}

export default About;