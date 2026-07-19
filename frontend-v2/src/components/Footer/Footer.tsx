import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.appFooter}>
      <span>
        Built by <strong>Aryan Goswami</strong>
      </span>
      <span className={styles.sep}>·</span>
      <span>Serverless on AWS</span>
      <span className={styles.sep}>·</span>
      <a
        href="https://github.com/aryangoswami1205/PegelSync"
        target="_blank"
        rel="noopener noreferrer"
      >
        GitHub
      </a>
    </footer>
  );
}
